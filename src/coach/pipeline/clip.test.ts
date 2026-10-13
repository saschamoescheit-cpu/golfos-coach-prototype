import { describe, expect, it } from 'vitest';
import type { Landmark, PoseFrame } from '../model/types';
import { synthSwing } from '../testing/synth';
import { findSwingWindow, fpsFromTimes, graySize, pickMainPerson, planFrameTimes, retimeSequence, suggestSlowMotionFactor } from './clip';

/** a synthetic swing embedded in a long clip: idle player before and after, plus a small fidget */
function longClip(beforeMs: number, afterMs: number, fps = 30) {
  const s = synthSwing({ fps, addressMs: 1200, finishHoldMs: 800, noise: 0.002 });
  const first = s.seq.frames[0].lm!;
  const last = s.seq.frames[s.seq.frames.length - 1].lm!;
  const frames: PoseFrame[] = [];
  const dt = 1000 / fps;
  let t = 0;
  for (; t < beforeMs; t += dt) {
    // small fidget of the hands in the middle of the idle time
    const fid = Math.abs(t - beforeMs / 2) < 300 ? 0.01 * Math.sin(t / 50) : 0;
    frames.push({ t, lm: first.map((p, i) => (i >= 15 && i <= 22 ? { ...p, x: p.x + fid } : p)) });
  }
  const offset = t;
  for (const f of s.seq.frames) frames.push({ t: offset + f.t, lm: f.lm });
  t = frames[frames.length - 1].t + dt;
  const endT = t + afterMs;
  for (; t < endT; t += dt) frames.push({ t, lm: last });
  const P = s.params;
  return {
    frames,
    aspect: P.width / P.height,
    takeaway: offset + P.addressMs,
    impact: offset + P.addressMs + P.backswingMs + P.downswingMs,
    finish: offset + P.addressMs + P.backswingMs + P.downswingMs + P.followMs,
  };
}

describe('pipeline helpers', () => {
  it('fpsFromTimes snaps to common rates', () => {
    expect(fpsFromTimes([0, 33.4, 66.7, 100.1, 133.4])).toBe(29.97);
    expect(fpsFromTimes([0, 1 / 240, 2 / 240, 3 / 240], 1000)).toBe(240);
    expect(fpsFromTimes([0, 40, 80, 120])).toBe(25);
    expect(fpsFromTimes([0])).toBe(0);
  });

  it('planFrameTimes: every frame up to 60 fps, frame centres, window', () => {
    const p = planFrameTimes(2, 30);
    expect(p.fps).toBe(30);
    expect(p.times.length).toBe(60);
    expect(p.times[0]).toBeCloseTo(1 / 60, 6);
    const s = planFrameTimes(4, 240, { maxFps: 60 });
    expect(s.fps).toBe(60);
    expect(s.times.length).toBe(240);
    const w = planFrameTimes(20, 30, { startS: 5, endS: 7 });
    expect(w.times.length).toBe(60);
    expect(w.times[0]).toBeGreaterThanOrEqual(5);
    expect(w.times[w.times.length - 1]).toBeLessThan(7);
  });

  it('planFrameTimes caps the number of frames (memory)', () => {
    const p = planFrameTimes(20, 60, { maxFrames: 300 });
    expect(p.times.length).toBeLessThanOrEqual(300);
    expect(p.fps).toBe(15);
  });

  it('graySize keeps the aspect ratio, longest side 360', () => {
    expect(graySize(1080, 1920)).toEqual({ width: 203, height: 360 });
    expect(graySize(1920, 1080)).toEqual({ width: 360, height: 203 });
    expect(graySize(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it('findSwingWindow finds the swing in a 20 s clip and skips fidgeting', () => {
    const c = longClip(12000, 6000);
    const w = findSwingWindow(c.frames, c.aspect, { preMs: 1000, postMs: 1000 })!;
    expect(w).not.toBeNull();
    expect(Math.abs(w.peakMs - c.impact)).toBeLessThanOrEqual(70);
    expect(Math.abs(w.motionStartMs - c.takeaway)).toBeLessThanOrEqual(250);
    expect(Math.abs(w.motionEndMs - c.finish)).toBeLessThanOrEqual(350);
    expect(w.startMs).toBeLessThanOrEqual(c.takeaway - 700);
    expect(w.endMs).toBeGreaterThanOrEqual(c.finish + 500);
    expect(w.endMs - w.startMs).toBeLessThanOrEqual(8000);
  });

  it('findSwingWindow respects maxMs', () => {
    const c = longClip(5000, 5000);
    const w = findSwingWindow(c.frames, c.aspect, { preMs: 4000, postMs: 4000, maxMs: 4000 })!;
    expect(w.endMs - w.startMs).toBeLessThanOrEqual(4000 + 1e-6);
    expect(w.startMs).toBeLessThan(w.peakMs);
    expect(w.endMs).toBeGreaterThan(w.peakMs);
  });

  it('findSwingWindow on a putt and with no motion', () => {
    const s = synthSwing({ shotType: 'putt', fps: 30, addressMs: 2000, finishHoldMs: 2000 });
    const w = findSwingWindow(s.seq.frames, 1080 / 1920)!;
    const P = s.params;
    expect(Math.abs(w.peakMs - (P.addressMs + P.backswingMs + P.downswingMs))).toBeLessThanOrEqual(150);
    const still = s.seq.frames.slice(0, 40);
    expect(findSwingWindow(still, 1080 / 1920)).toBeNull();
  });

  it('slow-motion detection: a ×8 stretched swing is recognised and retimed', () => {
    const s = synthSwing({ fps: 240, addressMs: 500, finishHoldMs: 500 });
    expect(suggestSlowMotionFactor(s.seq, 'iron')).toBeNull();
    // exported slo-mo: same frames, 8× longer timestamps, played at 30 fps
    const slow = { ...s.seq, fps: 30, frames: s.seq.frames.map((f) => ({ ...f, t: f.t * 8 })) };
    expect(suggestSlowMotionFactor(slow, 'iron')).toBe(8);
    for (const f of [2, 4]) {
      const sl = { ...s.seq, frames: s.seq.frames.map((x) => ({ ...x, t: x.t * f })) };
      expect(suggestSlowMotionFactor(sl, 'iron')).toBe(f);
    }
    for (const shotType of ['driver', 'pitch', 'chip', 'putt'] as const)
      expect(suggestSlowMotionFactor(synthSwing({ shotType, fps: 60 }).seq, shotType)).toBeNull();
    const back = retimeSequence(slow, 8);
    expect(back.fps).toBe(240);
    expect(back.frames[100].t).toBeCloseTo(s.seq.frames[100].t, 6);
  });

  it('pickMainPerson prefers the large central person and keeps tracking', () => {
    const person = (cx: number, h: number): Landmark[] =>
      Array.from({ length: 33 }, (_, i) => ({ x: cx + ((i % 3) - 1) * 0.05, y: 0.5 - h / 2 + (h * i) / 32, z: 0, v: 0.9 }));
    const player = person(0.5, 0.7);
    const bystander = person(0.85, 0.3);
    expect(pickMainPerson([bystander, player])).toBe(1);
    // a bystander that is closer to the camera (bigger) but far from where the player was
    const bigBystander = person(0.2, 0.8);
    expect(pickMainPerson([bigBystander, player], { x: 0.5, y: 0.5 })).toBe(1);
    expect(pickMainPerson([player])).toBe(0);
  });
});
