import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import { analyzeSequence, type AnalysisResult } from '../analysis/analyze';
import { FAULTS } from '../faults/catalog';
import { metricAvailable } from '../faults/metricContract';
import type { CameraView, FaultDef, ShotType } from '../model/types';
import { synthGrayFrame, synthSwing, type SynthParams } from '../testing/synth';
import { evaluateSeriesCriteria } from './series';
import { isTrainable, targetFromFault } from './targets';

/**
 * Review W2: a training target derived from a correction must be reachable with a GOOD swing. For every trainable fault
 * the synthetic ideal swing (fault's shot type, every view the target metric is measured in) has to be a hit, and the
 * swing with the fault's synthetic knob turned (where the generator has one) has to be a miss.
 */

/** synthetic knob that produces the fault (only where the generator has one) */
const KNOBS: Partial<Record<string, Partial<SynthParams>>> = {
  early_extension: { spineTiltImpactDelta: -12, hipDepthImpact: 0.08 },
  hip_sway: { hipShiftTop: -0.09 },
  over_the_top: { overTheTop: 0.1 },
  chicken_wing: { leadElbowFollow: 70 },
  short_shoulder_turn: { shoulderTurnTop: 40 },
  casting: { casting: 1 },
  tempo_fast: { backswingMs: 450, downswingMs: 250 },
  tempo_slow: { backswingMs: 1200, downswingMs: 250 },
  shaft_steep_downswing9: { shaftPlaneDevDown: 15 },
  // bent_lead_arm: no knob – the generator bends the elbow in the viewing direction at the top face-on (measures ~172°)
  flip_at_impact: { shaftLeanImpact: -6 },
  chip_scoop: { shaftLeanImpact: -8 },
  setup_upright: { spineTilt: 15 },
  setup_crouched: { spineTilt: 58 },
  chip_backswing_long: { armArcTop: 90 },
  pitch_backswing_long: { armArcTop: 160 },
  short_game_tempo: { backswingMs: 300, downswingMs: 300 },
  bunker_short_backswing: { armArcTop: 70, shoulderTurnTop: 45 },
  putt_body_movement: { strokeBodySway: 0.06 },
  putt_wrist_break: { puttWristBreak: 35 },
  putt_tempo: { backswingMs: 300, downswingMs: 300 },
};

const cache = new Map<string, { r: AnalysisResult; ctx: AnalysisContext }>();
function run(shotType: ShotType, view: CameraView, knob: Partial<SynthParams> = {}) {
  const key = JSON.stringify([shotType, view, knob]);
  const hit = cache.get(key);
  if (hit) return hit;
  const s = synthSwing({ shotType, view, ...knob });
  const ctx: AnalysisContext = { shotType, view, handedness: 'right' };
  const images = s.truth.club.map((c, i) => synthGrayFrame(c, { seed: i }));
  const out = { r: analyzeSequence({ raw: s.seq, images, ctx }), ctx };
  cache.set(key, out);
  return out;
}

const shotOf = (f: FaultDef): ShotType => (f.shotTypes.includes('iron') ? 'iron' : f.shotTypes[0]);
// putts are filmed face-on only (DECISIONS L3)
const viewsOf = (f: FaultDef, shot: ShotType): CameraView[] =>
  f.views.filter((v) => (shot !== 'putt' || v === 'face_on') && metricAvailable(f.trainingTarget!.metric, f.trainingTarget!.at, v, shot));

const trainable = FAULTS.filter(isTrainable);

describe('training targets from corrections (review W2)', () => {
  it('hides faults that cannot be measured (flying_elbow) from training', () => {
    expect(trainable.map((f) => f.id)).not.toContain('flying_elbow');
    expect(trainable.length).toBeGreaterThan(20);
  });

  const cases = trainable.flatMap((f) => viewsOf(f, shotOf(f)).map((v) => [f.id, v, f] as const));
  it.each(cases)('%s (%s): ideal swing is a hit, the fault knob a miss', (_id, view, f) => {
    const shot = shotOf(f);
    const target = targetFromFault(f, { shotType: shot, view, withGhost: false })!;
    const ideal = run(shot, view);
    const ev = evaluateSeriesCriteria(target, ideal.r, ideal.ctx);
    expect(ev.hit, `${f.id} ideal ${view}: ${ev.criteria.map((c) => c.value?.toFixed(1)).join(', ')} vs ${JSON.stringify(f.trainingTarget)}`).toBe(true);
    const knob = KNOBS[f.id];
    if (knob) {
      const bad = run(shot, view, knob);
      const evb = evaluateSeriesCriteria(target, bad.r, bad.ctx);
      expect(evb.hit, `${f.id} knob ${view}: ${evb.criteria.map((c) => c.value?.toFixed(1)).join(', ')}`).toBe(false);
    }
  });
});
