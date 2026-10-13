import { describe, expect, it } from 'vitest';
import { ALL_SHOT_TYPES } from '../model/constants';
import type { CameraView, Handedness, KeyPosition, PoseSequence, ShotType } from '../model/types';
import { toCanonical } from '../pose/mirror';
import { synthSwing, type SynthParams } from '../testing/synth';
import { detectKeyframes, detectPhases } from './phases';

const VIEWS: CameraView[] = ['face_on', 'down_the_line'];

/** Allowed timing error in ms per position (at 60 fps: 2 frames ≈ 33 ms). See docs/coach/decisions/phases-metrics.md. */
function tolMs(pos: KeyPosition, view: CameraView, shot: ShotType): number {
  const depth = view === 'down_the_line' && (shot === 'putt' || shot === 'chip');
  switch (pos) {
    case 'top':
      return depth ? 125 : 35;
    case 'impact':
      return depth ? 40 : 25;
    case 'address':
      return view === 'face_on' ? 70 : depth ? 140 : 105;
    case 'finish':
      return 70;
    default:
      return 50; // 9 o'clock
  }
}

function run(o: Partial<SynthParams>) {
  const s = synthSwing(o);
  const ctx = { shotType: s.params.shotType, view: s.params.view, handedness: s.params.handedness };
  const seq = toCanonical(s.seq, s.params.handedness);
  return { s, seq, ctx, det: detectPhases(seq, [], ctx) };
}

function errorsMs(s: ReturnType<typeof synthSwing>, kfs: { position: KeyPosition; frameIndex: number }[]) {
  const out: Partial<Record<KeyPosition, number>> = {};
  for (const [pos, ti] of Object.entries(s.truth.keyframes) as [KeyPosition, number][]) {
    const k = kfs.find((x) => x.position === pos);
    out[pos] = k ? ((k.frameIndex - ti) * 1000) / s.params.fps : NaN;
  }
  return out;
}

describe('detectKeyframes – accuracy on synthetic swings', () => {
  for (const view of VIEWS)
    for (const shotType of ALL_SHOT_TYPES)
      it(`${view} ${shotType}: all positions within tolerance (30/60/120 fps, noise, 5 % dropout, R+L)`, () => {
        const cases: Partial<SynthParams>[] = [];
        for (const fps of [30, 60, 120]) cases.push({ fps, noise: 0.003, dropout: 0.05, seed: fps });
        cases.push({ fps: 60, noise: 0.004, dropout: 0.05, seed: 11, handedness: 'left' as Handedness });
        cases.push({ fps: 60, noise: 0.002, seed: 5, handedness: 'left' as Handedness });
        for (const c of cases) {
          const { s, det } = run({ view, shotType, ...c });
          const err = errorsMs(s, det.keyframes);
          if (view === 'down_the_line' && shotType === 'putt') {
            // putt from behind: the stroke moves almost only in depth → only honest (low) confidence is required
            det.keyframes.forEach((k) => expect(k.confidence, k.position).toBeLessThan(0.5));
            continue;
          }
          for (const [pos, e] of Object.entries(err) as [KeyPosition, number][]) {
            // putt filmed from behind: the stroke moves almost only in depth – a missing address is acceptable
            if (Number.isNaN(e) && view === 'down_the_line' && shotType === 'putt' && pos === 'address') continue;
            const frameMs = 1000 / s.params.fps;
            const tol = Math.max(tolMs(pos, view, shotType), frameMs * 1.01);
            expect(Math.abs(e), `${pos} @${c.fps}fps ${c.handedness ?? 'right'} err ${e.toFixed(0)} ms`).toBeLessThanOrEqual(tol);
          }
          // every keyframe carries a confidence and a method, in swing order
          det.keyframes.forEach((k, i) => {
            expect(k.confidence).toBeGreaterThan(0);
            expect(k.confidence).toBeLessThanOrEqual(1);
            expect(k.method.length).toBeGreaterThan(0);
            if (i > 0) expect(k.frameIndex).toBeGreaterThanOrEqual(det.keyframes[i - 1].frameIndex);
          });
        }
      });
});

/** Relative tempo error allowed at 60 fps (one frame is already 8 % of a 0.2 s chip/putt downswing; see decisions). */
const TEMPO_TOL = { face_on: { full: 0.1, short: 0.25 }, down_the_line: { full: 0.15, short: 0.3 } };

describe('tempo', () => {
  for (const view of VIEWS)
    for (const shotType of ALL_SHOT_TYPES)
      it(`${view} ${shotType}: tempo at 60 fps (tolerance see TEMPO_TOL)`, () => {
        const short = shotType === 'putt' || shotType === 'chip';
        const tempos = short ? [[450, 225], [600, 300], [500, 200]] : [[750, 250], [900, 300], [600, 300]];
        for (const [bs, ds] of tempos) {
          const { s, det } = run({ view, shotType, fps: 60, noise: 0.003, dropout: 0.05, backswingMs: bs, downswingMs: ds, seed: bs });
          const t = det.timing;
          if (view === 'down_the_line' && shotType === 'putt') {
            // not timeable from behind (the stroke moves in depth): only require an honest, low confidence
            const kf = det.keyframes.filter((k) => k.position === 'address' || k.position === 'impact');
            expect(Math.min(...kf.map((k) => k.confidence))).toBeLessThan(0.5);
            continue;
          }
          const tempo = (t.topT! - t.takeawayT!) / (t.impactT! - t.topT!);
          const tol = TEMPO_TOL[view][short ? 'short' : 'full'];
          expect(Math.abs(tempo / s.truth.tempo - 1), `tempo ${tempo.toFixed(2)} vs ${s.truth.tempo}`).toBeLessThan(tol);
        }
      });
});

describe('robustness', () => {
  it('waggle before the swing does not move the address / top', () => {
    for (const view of VIEWS) {
      const { s, det } = run({ view, waggle: 10, addressMs: 1600, noise: 0.003, seed: 4 });
      const err = errorsMs(s, det.keyframes);
      expect(Math.abs(err.address!)).toBeLessThanOrEqual(tolMs('address', view, 'iron'));
      expect(Math.abs(err.top!)).toBeLessThanOrEqual(35);
    }
  });

  it('long still finish', () => {
    const { s, det } = run({ finishHoldMs: 3000, noise: 0.003, seed: 9 });
    expect(Math.abs(errorsMs(s, det.keyframes).finish!)).toBeLessThanOrEqual(70);
  });

  it('clip starting in the middle of the backswing: no address, rest still found, lower confidence', () => {
    for (const view of VIEWS) {
      const s = synthSwing({ view, noise: 0.003, seed: 2 });
      const cut = Math.round(((s.params.addressMs + 0.4 * s.params.backswingMs) * s.params.fps) / 1000);
      const seq: PoseSequence = { ...s.seq, frames: s.seq.frames.slice(cut) };
      const kf = detectKeyframes(seq, [], { shotType: 'iron', view, handedness: 'right' });
      expect(kf.find((k) => k.position === 'address')).toBeUndefined();
      const top = kf.find((k) => k.position === 'top')!;
      const imp = kf.find((k) => k.position === 'impact')!;
      expect(Math.abs(top.frameIndex + cut - s.truth.keyframes.top!)).toBeLessThanOrEqual(2);
      expect(Math.abs(imp.frameIndex + cut - s.truth.keyframes.impact!)).toBeLessThanOrEqual(2);
      expect(top.confidence).toBeLessThan(0.9);
    }
  });

  it('a clip without a swing gives no key positions', () => {
    const s = synthSwing({ noise: 0.003 });
    const still = { ...s.seq, frames: s.seq.frames.map((f) => ({ ...f, lm: s.seq.frames[0].lm })) };
    expect(detectKeyframes(still, [], { shotType: 'iron', view: 'face_on', handedness: 'right' })).toEqual([]);
  });

  it('9 o\'clock from the club when it is known (both views)', () => {
    for (const view of VIEWS)
      for (const fps of [30, 60, 120]) {
        const s = synthSwing({ view, fps, noise: 0.003, dropout: 0.05, seed: 7 });
        const kf = detectKeyframes(s.seq, s.truth.club, { shotType: 'iron', view, handedness: 'right' });
        for (const pos of ['backswing9', 'downswing9'] as const) {
          const k = kf.find((x) => x.position === pos)!;
          expect(k.method).toBe('club-parallel');
          expect(Math.abs(k.frameIndex - s.truth.keyframes[pos]!)).toBeLessThanOrEqual(Math.max(1, Math.round(fps / 60)));
          expect(k.confidence).toBeGreaterThan(0.6);
        }
      }
  });

  it('without the club the 9 o\'clock positions use the hand proxy with lower confidence', () => {
    const { det } = run({ noise: 0.003 });
    const b9 = det.keyframes.find((k) => k.position === 'backswing9')!;
    expect(b9.method).toBe('hands-proxy');
    expect(b9.confidence).toBeLessThan(0.5);
  });

  it('short shots only return their own positions', () => {
    const { det } = run({ shotType: 'putt' });
    expect(det.keyframes.map((k) => k.position)).toEqual(['address', 'top', 'impact', 'finish']);
  });
});
