import { describe, expect, it } from 'vitest';
import type { Line2 } from '../../coach/model/types';
import {
  clipLineToFrame,
  clubToDisplay,
  dragLine,
  frameAtTime,
  hitLine,
  lineFromDisplay,
  lineHandles,
  lineToDisplay,
  poseTimeOfVideo,
  videoTimeOfFrame,
} from './PlayerGeometry';

const frames = [0, 33.3, 66.7, 100, 133.3].map((t) => ({ t: t + 500, lm: null }));

describe('player geometry', () => {
  it('frameAtTime maps pose time to the shown frame', () => {
    expect(frameAtTime(frames, 0)).toBe(0);
    expect(frameAtTime(frames, 540)).toBe(1);
    expect(frameAtTime(frames, 566.7)).toBe(2);
    expect(frameAtTime(frames, 10000)).toBe(4);
    expect(frameAtTime([], 5)).toBe(0);
  });

  it('frame ↔ video time incl. slow-motion scale and trimmed clips (t does not start at 0)', () => {
    const seq: { frames: typeof frames; videoTimeScale?: number } = { frames };
    expect(videoTimeOfFrame(seq, 2)).toBeCloseTo(0.5667, 2);
    expect(frameAtTime(frames, poseTimeOfVideo(seq, videoTimeOfFrame(seq, 3)))).toBe(3);
    const slow = { frames: frames.map((f) => ({ ...f, t: f.t / 8 })), videoTimeScale: 8 };
    expect(videoTimeOfFrame(slow, 2)).toBeCloseTo(0.5667, 2);
    expect(frameAtTime(slow.frames, poseTimeOfVideo(slow, videoTimeOfFrame(slow, 4)))).toBe(4);
  });

  it('display mirroring is its own inverse; club angle mirrors', () => {
    const l: Line2 = { a: { x: 0.3, y: 0.4 }, b: { x: 0.6, y: 0.9 } };
    expect(lineToDisplay(l, false)).toBe(l);
    expect(lineToDisplay(l, true)!.a.x).toBeCloseTo(0.7);
    expect(lineFromDisplay(lineToDisplay(l, true), true)!.a.x).toBeCloseTo(l.a.x, 9);
    const c = clubToDisplay({ grip: { x: 0.4, y: 0.5 }, head: { x: 0.6, y: 0.9 }, angleDeg: 30, source: 'image', confidence: 1 }, true)!;
    expect(c.grip.x).toBeCloseTo(0.6);
    expect(c.angleDeg).toBe(150);
  });

  it('clips the extended line to the picture', () => {
    const c = clipLineToFrame({ a: { x: 0.4, y: 0.5 }, b: { x: 0.6, y: 0.7 } })!;
    expect(c.a.x).toBeCloseTo(0);
    expect(c.a.y).toBeCloseTo(0.1);
    expect(c.b.x).toBeCloseTo(0.5 + 0.4); // y hits 1 at x = 0.9
    expect(c.b.y).toBeCloseTo(1);
    expect(clipLineToFrame({ a: { x: 2, y: 2 }, b: { x: 3, y: 2 } })).toBeNull();
  });

  it('hit test and drag: handle turns the line, body moves it', () => {
    const l: Line2 = { a: { x: 0.2, y: 0.2 }, b: { x: 0.8, y: 0.8 } };
    const [h1, h2] = lineHandles(l)!;
    const W = 400;
    const H = 700;
    expect(hitLine(l, { x: h1.x * W, y: h1.y * H }, W, H)).toBe('a');
    expect(hitLine(l, { x: h2.x * W + 5, y: h2.y * H }, W, H)).toBe('b');
    expect(hitLine(l, { x: 0.5 * W, y: 0.5 * H }, W, H)).toBe('move');
    expect(hitLine(l, { x: 0.9 * W, y: 0.1 * H }, W, H)).toBeNull();
    const moved = dragLine(l, 'move', { x: 0.1, y: 0 });
    expect(moved.a.x - h1.x).toBeCloseTo(0.1);
    expect(moved.b.x - h2.x).toBeCloseTo(0.1);
    const turned = dragLine(l, 'b', { x: 0, y: -0.2 });
    expect(turned.a).toEqual(h1);
    expect(turned.b.y).toBeCloseTo(h2.y - 0.2);
  });
});
