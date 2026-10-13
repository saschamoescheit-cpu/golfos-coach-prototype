import { describe, expect, it } from 'vitest';
import { QUALITY_MIN } from '../model/constants';
import type { ClubEstimate, PhaseKeyframe, PoseSequence } from '../model/types';
import { toCanonical } from '../pose/mirror';
import { smoothSequence } from '../pose/smoothing';
import { synthSwing, type SynthParams, type SynthSwing } from '../testing/synth';
import type { AnalysisContext } from './context';
import { assessQuality, playerHeight } from './quality';

const kfs = (s: SynthSwing): PhaseKeyframe[] =>
  Object.entries(s.truth.keyframes).map(([position, frameIndex]) => ({
    position: position as PhaseKeyframe['position'],
    frameIndex: frameIndex!,
    t: s.seq.frames[frameIndex!].t,
    confidence: 1,
    method: 'truth',
  }));

function run(p: Partial<SynthParams> = {}, ctxOver: Partial<AnalysisContext> = {}, mod?: (seq: PoseSequence) => PoseSequence) {
  const s = synthSwing(p);
  const ctx: AnalysisContext = { shotType: s.params.shotType, view: s.params.view, handedness: s.params.handedness, ...ctxOver };
  let seq = smoothSequence(toCanonical(s.seq, ctx.handedness));
  if (mod) seq = mod(seq);
  return assessQuality(seq, ctx, { keyframes: kfs(s), club: s.truth.club });
}

describe('assessQuality', () => {
  for (const view of ['face_on', 'down_the_line'] as const)
    for (const shotType of ['driver', 'pitch', 'chip', 'putt'] as const)
      it(`clean synthetic ${shotType} ${view} → good score, no issues`, () => {
        const q = run({ view, shotType });
        expect(q.issues).toEqual([]);
        expect(q.score).toBeGreaterThan(0.85);
        expect(q.detectedFrameRatio).toBe(1);
      });

  it('left-handed player analysed as left-handed is fine', () => {
    const q = run({ handedness: 'left' });
    expect(q.issues).toEqual([]);
  });

  it('no person', () => {
    const q = run({}, {}, (s) => ({ ...s, frames: s.frames.map((f) => ({ ...f, lm: null })) }));
    expect(q.issues).toContain('no_person');
    expect(q.score).toBe(0);
  });

  it('too far away', () => {
    const q = run({ zoom: 0.4 });
    expect(q.issues).toContain('too_far');
    expect(q.issues).not.toContain('body_cut_off');
  });

  it('player height of a normal recording is clearly above the limit', () => {
    const s = synthSwing({});
    expect(playerHeight(s.seq.frames.map((f) => f.lm!))).toBeGreaterThan(0.5);
  });

  it('dark video → low visibility, nothing diagnosed', () => {
    const q = run({ visibility: 0.45 });
    expect(q.issues).toContain('low_visibility');
    expect(q.score).toBeLessThan(QUALITY_MIN);
  });

  it('low frame rate is reported but still analysable', () => {
    const q = run({ fps: 24 });
    expect(q.issues).toContain('low_fps');
    expect(q.score).toBeGreaterThanOrEqual(QUALITY_MIN);
  });

  it('30 fps (29.97) is not low', () => {
    const q = run({ fps: 29.97 });
    expect(q.issues).not.toContain('low_fps');
  });

  it('too short clip', () => {
    const q = run({}, {}, (s) => ({ ...s, frames: s.frames.slice(0, 15) }));
    expect(q.issues).toContain('too_short');
  });

  it('missing key frames → no swing found, below QUALITY_MIN', () => {
    const s = synthSwing({});
    const ctx: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
    const q = assessQuality(smoothSequence(s.seq), ctx, { keyframes: kfs(s).filter((k) => k.position !== 'impact') });
    expect(q.issues).toContain('no_swing_found');
    expect(q.score).toBeLessThan(QUALITY_MIN);
    // first call without key frames does not complain
    expect(assessQuality(smoothSequence(s.seq), ctx).issues).not.toContain('no_swing_found');
  });

  it('feet below the frame → body cut off', () => {
    const q = run({}, {}, (s) => ({
      ...s,
      frames: s.frames.map((f) => ({ ...f, lm: f.lm!.map((p) => ({ ...p, y: p.y + 0.16 })) })),
    }));
    expect(q.issues).toContain('body_cut_off');
  });

  it('camera moving (whole picture drifts)', () => {
    const q = run({}, {}, (s) => ({
      ...s,
      frames: s.frames.map((f, i) => ({ ...f, lm: f.lm!.map((p) => ({ ...p, x: p.x + i * 0.0015 })) })),
    }));
    expect(q.issues).toContain('camera_moving');
  });

  it('right-handed video analysed as left-handed → mirrored suspected (face-on and DTL)', () => {
    for (const view of ['face_on', 'down_the_line'] as const) {
      const q = run({ view }, { handedness: 'left' });
      expect(q.issues).toContain('mirrored_suspected');
      expect(q.score).toBeLessThan(QUALITY_MIN);
    }
  });

  it('mirrored check also works without key frames and for putts', () => {
    const s = synthSwing({ shotType: 'putt' });
    const ctx: AnalysisContext = { shotType: 'putt', view: 'face_on', handedness: 'left' };
    expect(assessQuality(smoothSequence(toCanonical(s.seq, 'left')), ctx).issues).toContain('mirrored_suspected');
    expect(assessQuality(smoothSequence(s.seq), { ...ctx, handedness: 'right' }).issues).not.toContain('mirrored_suspected');
  });

  it('club only estimated from the hands → club_not_found (small penalty)', () => {
    const s = synthSwing({});
    const ctx: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
    const club: ClubEstimate[] = s.truth.club.map((c) => ({ ...c, source: 'hands', confidence: 0.3 }));
    const q = assessQuality(smoothSequence(s.seq), ctx, { keyframes: kfs(s), club });
    expect(q.issues).toEqual(['club_not_found']);
    expect(q.score).toBeGreaterThan(QUALITY_MIN);
    expect(assessQuality(smoothSequence(s.seq), ctx, { keyframes: kfs(s), club: club.map(() => null) }).issues).toContain('club_not_found');
  });

  it('several people in the picture', () => {
    const q = run({}, {}, (s) => ({ ...s, multiPersonRatio: 0.8 }));
    expect(q.issues).toContain('multiple_people');
  });

  it('random dropout and noise stay analysable', () => {
    const q = run({ noise: 0.004, dropout: 0.1, seed: 4 });
    expect(q.score).toBeGreaterThan(QUALITY_MIN);
    expect(q.issues).toEqual([]);
  });
});
