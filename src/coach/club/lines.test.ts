import { describe, expect, it } from 'vitest';
import type { ClubEstimate } from '../model/types';
import {
  angleVsNeutralDeg,
  clubFromPoints,
  extendLine,
  isMeasuredClub,
  lineAngleDeg,
  lineFromPoints,
  mirrorClub,
  mirrorLine,
  shaftToHorizontalDeg,
  undirectedDiff,
} from './lines';

const aspect = 9 / 16;

describe('line helpers', () => {
  it('computes line angles in pixel space', () => {
    // 45° on screen in a portrait video: dx in normalized units must be stretched by 1/aspect
    const l = lineFromPoints({ x: 0.5, y: 0.5 }, { x: 0.5 + 0.1 / aspect, y: 0.6 });
    expect(lineAngleDeg(l, aspect)).toBeCloseTo(45, 6);
    expect(lineAngleDeg(lineFromPoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 }), aspect)).toBeCloseTo(-90, 6);
  });

  it('undirected difference stays within (−90, 90]', () => {
    expect(undirectedDiff(10, 190)).toBeCloseTo(0, 6);
    expect(undirectedDiff(100, 0)).toBeCloseTo(-80, 6);
    expect(undirectedDiff(-170, 170)).toBeCloseTo(20, 6);
  });

  it('signs shaft vs neutral line: + steep (head right/above), − flat (head left/below)', () => {
    // canonical DTL: neutral line from the ball (lower right) up-left through the hands, 60° to the horizontal
    const hands = { x: 0.45, y: 0.55 };
    const r = (60 * Math.PI) / 180;
    const ball = { x: hands.x + (0.3 * Math.cos(r)) / aspect, y: hands.y + 0.3 * Math.sin(r) };
    const neutral = lineFromPoints(ball, hands);
    const mk = (angle: number) => {
      const a = (angle * Math.PI) / 180;
      return clubFromPoints(hands, { x: hands.x + (0.3 * Math.cos(a)) / aspect, y: hands.y + 0.3 * Math.sin(a) }, aspect, 'image', 0.9);
    };
    // head on the upper half (P6/top): neutral direction up-left = −120°
    expect(angleVsNeutralDeg(mk(-120).angleDeg, neutral, aspect)).toBeCloseTo(0, 6);
    expect(angleVsNeutralDeg(mk(-100).angleDeg, neutral, aspect)).toBeCloseTo(20, 6); // head turned up/right → steep
    expect(angleVsNeutralDeg(mk(-140).angleDeg, neutral, aspect)).toBeCloseTo(-20, 6); // head turned left/down → flat
    // head on the lower half (early backswing): neutral direction down-right = 60°
    expect(angleVsNeutralDeg(mk(40).angleDeg, neutral, aspect)).toBeCloseTo(20, 6); // head above the line → steep
    expect(angleVsNeutralDeg(mk(80).angleDeg, neutral, aspect)).toBeCloseTo(-20, 6); // head below the line → flat
    // orientation of the neutral line does not matter
    expect(angleVsNeutralDeg(mk(-100).angleDeg, lineFromPoints(hands, ball), aspect)).toBeCloseTo(20, 6);
  });

  it('measures the shaft against the horizontal (9 o’clock)', () => {
    const c = clubFromPoints({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.5 }, aspect, 'image', 1);
    expect(shaftToHorizontalDeg(c)).toBeCloseTo(0, 6);
  });

  it('mirrors clubs and lines for display', () => {
    const c = clubFromPoints({ x: 0.4, y: 0.5 }, { x: 0.7, y: 0.8 }, aspect, 'image', 0.8);
    const m = mirrorClub(c);
    expect(m.grip.x).toBeCloseTo(0.6, 9);
    expect(m.head.x).toBeCloseTo(0.3, 9);
    const recomputed = clubFromPoints(m.grip, m.head, aspect, 'image', 0.8);
    expect(undirectedDiff(m.angleDeg, recomputed.angleDeg)).toBeCloseTo(0, 6);
    expect(m.angleDeg).toBeCloseTo(recomputed.angleDeg, 6);
    expect(mirrorClub(m).angleDeg).toBeCloseTo(c.angleDeg, 6);
    const l = mirrorLine(lineFromPoints({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }));
    expect(l.a.x).toBeCloseTo(0.9, 9);
    expect(l.b.x).toBeCloseTo(0.7, 9);
  });

  it('extends a line on both ends', () => {
    const l = extendLine(lineFromPoints({ x: 0, y: 0 }, { x: 1, y: 1 }), 0.5, 1);
    expect(l.a).toEqual({ x: -0.5, y: -0.5 });
    expect(l.b).toEqual({ x: 2, y: 2 });
  });

  it('counts only image/manual clubs with enough confidence as measured', () => {
    const base: ClubEstimate = { grip: { x: 0, y: 0 }, head: { x: 1, y: 1 }, angleDeg: 45, source: 'image', confidence: 0.9 };
    expect(isMeasuredClub(base)).toBe(true);
    expect(isMeasuredClub({ ...base, source: 'hands', confidence: 0.4 })).toBe(false);
    expect(isMeasuredClub({ ...base, confidence: 0.2 })).toBe(false);
    expect(isMeasuredClub({ ...base, source: 'manual' })).toBe(true);
    expect(isMeasuredClub(null)).toBe(false);
  });
});
