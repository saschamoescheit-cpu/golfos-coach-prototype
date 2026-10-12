import { describe, expect, it } from 'vitest';
import { LM } from '../model/constants';
import { synthSwing } from './synth';
import { toCanonical } from '../pose/mirror';

const handsX = (lm: { x: number }[]) => (lm[LM.LEFT_WRIST].x + lm[LM.RIGHT_WRIST].x) / 2;
const handsY = (lm: { y: number }[]) => (lm[LM.LEFT_WRIST].y + lm[LM.RIGHT_WRIST].y) / 2;

describe('synthetic swing generator', () => {
  it('face-on right-hander: hands go away from the target (image left) and up in the backswing', () => {
    const { seq, truth } = synthSwing({ view: 'face_on' });
    const a = seq.frames[truth.keyframes.address!].lm!;
    const top = seq.frames[truth.keyframes.top!].lm!;
    expect(handsX(top)).toBeLessThan(handsX(a));
    expect(handsY(top)).toBeLessThan(handsY(a) - 0.1);
    const imp = seq.frames[truth.keyframes.impact!].lm!;
    expect(Math.abs(handsY(imp) - handsY(a))).toBeLessThan(0.03);
  });

  it('shaft is roughly parallel to the ground at the 9 o\'clock positions (face-on)', () => {
    const { truth } = synthSwing({ view: 'face_on' });
    for (const pos of ['backswing9', 'downswing9'] as const) {
      const c = truth.club[truth.keyframes[pos]!];
      const a = Math.abs(c.angleDeg);
      expect(Math.min(a, 180 - a)).toBeLessThan(12);
    }
    // at address the club head is below the hands
    const c0 = truth.club[truth.keyframes.address!];
    expect(c0.head.y).toBeGreaterThan(c0.grip.y);
  });

  it('down-the-line: the player faces image right (ball side)', () => {
    const { seq, truth } = synthSwing({ view: 'down_the_line' });
    const a = seq.frames[truth.keyframes.address!].lm!;
    const hipX = (a[LM.LEFT_HIP].x + a[LM.RIGHT_HIP].x) / 2;
    expect(handsX(a)).toBeGreaterThan(hipX);
    const c0 = truth.club[truth.keyframes.address!];
    expect(c0.head.x).toBeGreaterThan(c0.grip.x);
  });

  it('left-hander output is mirrored and maps back to the right-handed swing', () => {
    const right = synthSwing({ view: 'face_on' });
    const left = synthSwing({ view: 'face_on', handedness: 'left' });
    const canon = toCanonical(left.seq, 'left');
    const i = right.truth.keyframes.top!;
    expect(canon.frames[i].lm![LM.LEFT_WRIST].x).toBeCloseTo(right.seq.frames[i].lm![LM.LEFT_WRIST].x, 6);
    expect(left.seq.frames[i].lm![LM.LEFT_WRIST].x).toBeCloseTo(1 - right.seq.frames[i].lm![LM.RIGHT_WRIST].x, 6);
  });

  it('tempo truth and key frame order', () => {
    const { truth } = synthSwing({ backswingMs: 900, downswingMs: 300 });
    expect(truth.tempo).toBeCloseTo(3);
    const k = truth.keyframes;
    expect(k.address! < k.backswing9! && k.backswing9! < k.top! && k.top! < k.downswing9! && k.downswing9! < k.impact! && k.impact! < k.finish!).toBe(true);
  });

  it('short shots have no 9 o\'clock positions', () => {
    expect(synthSwing({ shotType: 'putt' }).truth.keyframes.backswing9).toBeUndefined();
    expect(synthSwing({ shotType: 'chip' }).truth.keyframes.downswing9).toBeUndefined();
  });
});
