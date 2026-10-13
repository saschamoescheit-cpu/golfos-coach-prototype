import { describe, expect, it } from 'vitest';
import { LM } from '../model/constants';
import type { PoseSequence } from '../model/types';
import { synthSwing } from '../testing/synth';
import { fillGaps, smoothSequence } from './smoothing';

const JOINTS = [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_SHOULDER, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.NOSE];

function rmsError(a: PoseSequence, truth: PoseSequence): number {
  let s = 0;
  let n = 0;
  a.frames.forEach((f, i) => {
    const g = truth.frames[i].lm!;
    if (!f.lm) return;
    for (const j of JOINTS) {
      s += (f.lm[j].x - g[j].x) ** 2 + (f.lm[j].y - g[j].y) ** 2;
      n++;
    }
  });
  return Math.sqrt(s / n);
}

/** frame index of the fastest hand movement (centred difference) */
function handSpeedPeak(seq: PoseSequence): number {
  const aspect = seq.width / seq.height;
  let best = -1;
  let bi = -1;
  for (let i = 1; i < seq.frames.length - 1; i++) {
    const a = seq.frames[i - 1].lm;
    const b = seq.frames[i + 1].lm;
    if (!a || !b) continue;
    const hx = (l: typeof a) => ((l[15].x + l[16].x) / 2) * aspect;
    const hy = (l: typeof a) => (l[15].y + l[16].y) / 2;
    const v = Math.hypot(hx(b) - hx(a), hy(b) - hy(a)) / (seq.frames[i + 1].t - seq.frames[i - 1].t);
    if (v > best) {
      best = v;
      bi = i;
    }
  }
  return bi;
}

describe('smoothSequence', () => {
  it('keeps length and timestamps', () => {
    const { seq } = synthSwing({ noise: 0.004, dropout: 0.1, fps: 30 });
    const out = smoothSequence(seq);
    expect(out.frames.length).toBe(seq.frames.length);
    out.frames.forEach((f, i) => expect(f.t).toBe(seq.frames[i].t));
    expect(out.width).toBe(seq.width);
    expect(out.mirrored).toBe(seq.mirrored);
  });

  for (const fps of [30, 60, 240]) {
    for (const view of ['face_on', 'down_the_line'] as const) {
      it(`reduces noise at ${fps} fps (${view})`, () => {
        const clean = synthSwing({ fps, view }).seq;
        const noisy = synthSwing({ fps, view, noise: 0.005, seed: 3 }).seq;
        const before = rmsError(noisy, clean);
        const after = rmsError(smoothSequence(noisy), clean);
        expect(after).toBeLessThan(before * 0.8);
      });
    }
  }

  for (const fps of [30, 60]) {
    it(`does not shift the hand-speed peak (impact) at ${fps} fps`, () => {
      const { seq: clean, truth } = synthSwing({ fps });
      const peakClean = handSpeedPeak(clean);
      expect(Math.abs(peakClean - truth.keyframes.impact!)).toBeLessThanOrEqual(1);
      expect(Math.abs(handSpeedPeak(smoothSequence(clean)) - peakClean)).toBeLessThanOrEqual(1);
      const noisy = synthSwing({ fps, noise: 0.003, seed: 5 }).seq;
      expect(Math.abs(handSpeedPeak(smoothSequence(noisy)) - peakClean)).toBeLessThanOrEqual(1);
    });
  }

  it('fills short gaps (≤ 150 ms) and leaves long gaps empty', () => {
    const { seq } = synthSwing({ fps: 30 });
    const frames = seq.frames.map((f, i) => {
      if (i >= 20 && i <= 23) return { ...f, lm: null }; // 4 missing frames ≈ 133 ms
      if (i >= 40 && i <= 47) return { ...f, lm: null }; // 8 missing ≈ 267 ms
      return f;
    });
    const out = smoothSequence({ ...seq, frames });
    for (let i = 20; i <= 23; i++) {
      const g = seq.frames[i].lm!;
      const f = out.frames[i].lm!;
      expect(f).not.toBeNull();
      expect(Math.abs(f[LM.LEFT_WRIST].x - g[LM.LEFT_WRIST].x)).toBeLessThan(0.02);
      expect(Math.abs(f[LM.LEFT_WRIST].y - g[LM.LEFT_WRIST].y)).toBeLessThan(0.02);
      expect(f[LM.LEFT_WRIST].v).toBeLessThan(g[LM.LEFT_WRIST].v);
    }
    for (let i = 40; i <= 47; i++) expect(out.frames[i].lm).toBeNull();
  });

  it('random dropout + noise: error lower than the raw detections', () => {
    const clean = synthSwing({ fps: 60 }).seq;
    const noisy = synthSwing({ fps: 60, noise: 0.004, dropout: 0.15, seed: 9 }).seq;
    const out = smoothSequence(noisy);
    const detected = out.frames.filter((f) => f.lm).length;
    expect(detected).toBeGreaterThan(noisy.frames.filter((f) => f.lm).length);
    expect(rmsError(out, clean)).toBeLessThan(rmsError(noisy, clean) * 0.8);
  });

  it('removes a single-frame outlier (wrist jumps to the other hand)', () => {
    const { seq } = synthSwing({ fps: 60 });
    const i = 30;
    const lm = seq.frames[i].lm!.map((p) => ({ ...p }));
    lm[LM.LEFT_WRIST] = { ...lm[LM.LEFT_WRIST], x: lm[LM.LEFT_WRIST].x + 0.15 };
    const frames = seq.frames.map((f, k) => (k === i ? { ...f, lm } : f));
    const out = smoothSequence({ ...seq, frames });
    expect(Math.abs(out.frames[i].lm![LM.LEFT_WRIST].x - seq.frames[i].lm![LM.LEFT_WRIST].x)).toBeLessThan(0.01);
  });

  it('low-visibility points follow their neighbours', () => {
    const { seq } = synthSwing({ fps: 60 });
    const i = 25;
    const lm = seq.frames[i].lm!.map((p) => ({ ...p }));
    lm[LM.NOSE] = { ...lm[LM.NOSE], y: lm[LM.NOSE].y + 0.08, v: 0.05 };
    const frames = seq.frames.map((f, k) => (k === i ? { ...f, lm } : f));
    const out = smoothSequence({ ...seq, frames, }, { robust: false });
    expect(Math.abs(out.frames[i].lm![LM.NOSE].y - seq.frames[i].lm![LM.NOSE].y)).toBeLessThan(0.01);
  });

  it('fillGaps uses neighbour tangents (curved path)', () => {
    const times = [0, 10, 20, 30, 40, 50];
    const mk = (x: number) => [{ x, y: x * x, z: 0, v: 1 }];
    const lms = [mk(0), mk(1), null, null, mk(4), mk(5)];
    const r = fillGaps(times, lms, 150, 10);
    expect(r.filled).toEqual([false, false, true, true, false, false]);
    expect(r.lm[2]![0].x).toBeCloseTo(2, 5);
    expect(Math.abs(r.lm[2]![0].y - 4)).toBeLessThan(0.3);
  });

  it('empty sequence is returned unchanged', () => {
    const seq: PoseSequence = { width: 1, height: 1, fps: 30, frames: [], mirrored: false };
    expect(smoothSequence(seq)).toBe(seq);
  });
});
