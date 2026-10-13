import { describe, expect, it } from 'vitest';
import { ALL_SHOT_TYPES } from '../model/constants';
import type { ClubEstimate, KeyPosition, MetricId, SwingMetrics } from '../model/types';
import { metricAvailable } from '../faults/metricContract';
import { evaluateFaults } from '../faults/engine';
import { computeSwingScore } from '../faults/score';
import { toCanonical } from '../pose/mirror';
import { synthSwing, type SynthParams } from '../testing/synth';
import type { AnalysisContext } from './context';
import { computeMetrics, getMetric, metricsAtFrame } from './metrics';
import { detectKeyframes } from './phases';

/** Full analysis of a synthetic swing (truth club = what a working club tracker would deliver). */
function analyse(o: Partial<SynthParams>, opts: { club?: 'truth' | 'none' | 'hands' } = {}) {
  const s = synthSwing({ noise: 0.003, seed: 3, ...o });
  const ctx: AnalysisContext = { view: s.params.view, shotType: s.params.shotType, handedness: s.params.handedness };
  const seq = toCanonical(s.seq, s.params.handedness);
  const mode = opts.club ?? 'truth';
  let club: (ClubEstimate | null)[] = [];
  if (mode === 'truth') club = s.truth.club;
  if (mode === 'hands') club = s.truth.club.map((c) => ({ ...c, source: 'hands' as const, confidence: 0.9 }));
  const keyframes = detectKeyframes(seq, club, ctx);
  const metrics = computeMetrics(seq, club, keyframes, null, ctx);
  return { s, ctx, seq, club, keyframes, metrics };
}

function value(m: SwingMetrics, id: MetricId, at: KeyPosition | 'swing'): number {
  const v = getMetric(m, id, at);
  expect(v, `${id}@${at} missing`).toBeDefined();
  return v!.value;
}

/** Default vs. knob for one metric; returns both values. */
function knob(o: Partial<SynthParams>, base: Partial<SynthParams>, id: MetricId, at: KeyPosition | 'swing', club: 'truth' | 'none' = 'truth') {
  return { def: value(analyse(base, { club }).metrics, id, at), bad: value(analyse({ ...base, ...o }, { club }).metrics, id, at) };
}

const FO = { view: 'face_on' as const };
const DTL = { view: 'down_the_line' as const };

describe('computeMetrics – every fault knob of the synthetic swing moves its metric', () => {
  it('early extension: hips towards the ball (DTL hip_depth_change@impact up)', () => {
    const { def, bad } = knob({ hipDepthImpact: 0.08 }, DTL, 'hip_depth_change', 'impact');
    expect(Math.abs(def)).toBeLessThan(3);
    expect(bad).toBeGreaterThan(def + 10);
  });
  it('early extension: standing up (DTL spine_angle_change@impact negative)', () => {
    const { def, bad } = knob({ spineTiltImpactDelta: -12 }, DTL, 'spine_angle_change', 'impact');
    expect(Math.abs(def)).toBeLessThan(2);
    expect(bad).toBeLessThan(-9);
  });
  it('head sway at the top (FO head_shift_x@top more negative)', () => {
    const { def, bad } = knob({ headShiftTopX: -0.06 }, FO, 'head_shift_x', 'top');
    expect(bad).toBeLessThan(def - 10);
  });
  it('hip sway away from the target (FO hip_shift_x@top negative)', () => {
    const { def, bad } = knob({ hipShiftTop: -0.08 }, FO, 'hip_shift_x', 'top');
    expect(Math.abs(def)).toBeLessThan(4);
    expect(bad).toBeLessThan(-10);
  });
  it('reverse pivot: upper body towards the target and hips towards the target at the top', () => {
    const k = { sideBendTop: 10, hipShiftTop: 0.05 };
    const sb = knob(k, FO, 'side_bend', 'top');
    expect(sb.def).toBeGreaterThan(3); // normal: spine tilted away from the target
    expect(sb.bad).toBeLessThan(-8); // reverse pivot: tilted towards the target
    const hs = knob(k, FO, 'hip_shift_x', 'top');
    expect(hs.bad).toBeGreaterThan(hs.def + 8);
  });
  it('chicken wing (FO lead_arm_post_impact small)', () => {
    const { def, bad } = knob({ leadElbowFollow: 70 }, FO, 'lead_arm_post_impact', 'swing');
    expect(def).toBeGreaterThan(155);
    expect(bad).toBeLessThan(def - 30);
  });
  it('over the top (DTL hand_path_shift positive)', () => {
    const { def, bad } = knob({ overTheTop: 0.12 }, DTL, 'hand_path_shift', 'downswing9');
    expect(bad).toBeGreaterThan(def + 6);
    expect(bad).toBeGreaterThan(8);
  });
  it('casting (lead_wrist_hinge@downswing9 small, with club)', () => {
    const { def, bad } = knob({ casting: 1 }, FO, 'lead_wrist_hinge', 'downswing9');
    expect(bad).toBeLessThan(def - 8);
  });
  it('too little shoulder turn (shoulder_turn@top smaller, both views)', () => {
    for (const v of [FO, DTL]) {
      const { def, bad } = knob({ shoulderTurnTop: 60 }, v, 'shoulder_turn', 'top');
      expect(bad).toBeLessThan(def - 15);
    }
  });
  it('shaft steep / flat at 9 o\'clock downswing (DTL shaft_plane_dev sign, with club)', () => {
    const steep = knob({ shaftPlaneDevDown: 15 }, DTL, 'shaft_plane_dev', 'downswing9');
    const flat = knob({ shaftPlaneDevDown: -15 }, DTL, 'shaft_plane_dev', 'downswing9');
    expect(Math.abs(steep.def)).toBeLessThan(2);
    expect(steep.bad).toBeGreaterThan(6);
    expect(flat.bad).toBeLessThan(-6);
    const back = knob({ shaftPlaneDevBack: 15 }, DTL, 'shaft_plane_dev', 'backswing9');
    expect(back.bad).toBeGreaterThan(6);
  });
  it('putt: wrist break (putter_wrist_change up, with and without club) and body sway (body_motion up)', () => {
    const P = { ...FO, shotType: 'putt' as const };
    for (const club of ['truth', 'none'] as const) {
      const { def, bad } = knob({ puttWristBreak: 20 }, P, 'putter_wrist_change', 'swing', club);
      expect(bad).toBeGreaterThan(def + 12);
    }
    const bm = knob({ strokeBodySway: 0.05 }, P, 'body_motion', 'swing');
    expect(bm.def).toBeLessThan(6);
    expect(bm.bad).toBeGreaterThan(bm.def + 12);
  });
});

describe('computeMetrics – contract and confidence', () => {
  it('only metrics of the contract table for the view / shot type, all finite with confidence 0..1', () => {
    for (const shotType of ALL_SHOT_TYPES)
      for (const view of ['face_on', 'down_the_line'] as const) {
        const { metrics } = analyse({ view, shotType });
        // a putt filmed from behind may give nothing at all (stroke moves in depth) – that is allowed
        if (!(view === 'down_the_line' && shotType === 'putt')) expect(metrics.values.length).toBeGreaterThan(3);
        for (const v of metrics.values) {
          expect(metricAvailable(v.id, v.at, view, shotType), `${v.id}@${v.at} ${view} ${shotType}`).toBe(true);
          expect(Number.isFinite(v.value)).toBe(true);
          expect(v.confidence).toBeGreaterThanOrEqual(0);
          expect(v.confidence).toBeLessThanOrEqual(1);
        }
      }
  });

  it('tempo of the default iron swing is ~3:1', () => {
    const { metrics } = analyse(FO);
    expect(value(metrics, 'tempo_ratio', 'swing')).toBeGreaterThan(2.7);
    expect(value(metrics, 'tempo_ratio', 'swing')).toBeLessThan(3.3);
  });

  it('club estimated from the hands → club metrics have confidence ≤ 0.4', () => {
    const { metrics } = analyse(FO, { club: 'hands' });
    for (const id of ['lead_wrist_hinge', 'shaft_lean'] as MetricId[])
      for (const v of metrics.values.filter((x) => x.id === id)) expect(v.confidence).toBeLessThanOrEqual(0.4);
  });

  it('without club: no club metrics except documented proxies (low confidence)', () => {
    const { metrics } = analyse(DTL, { club: 'none' });
    expect(metrics.values.find((v) => v.id === 'shaft_plane_dev')).toBeUndefined();
    expect(metrics.values.find((v) => v.id === 'lead_wrist_hinge')).toBeUndefined();
    const fo = analyse(FO, { club: 'none' }).metrics;
    expect(getMetric(fo, 'hands_ahead', 'impact')!.confidence).toBeLessThan(0.5);
  });

  it('left-handed swing gives the same metrics as the right-handed one', () => {
    for (const view of ['face_on', 'down_the_line'] as const) {
      const r = analyse({ view, noise: 0 }).metrics;
      const l = analyse({ view, noise: 0, handedness: 'left' }).metrics;
      for (const v of r.values) {
        const w = getMetric(l, v.id, v.at);
        expect(w, `${v.id}@${v.at}`).toBeDefined();
        expect(Math.abs(w!.value - v.value), `${v.id}@${v.at}`).toBeLessThan(0.5);
      }
    }
  });

  it('metricsAtFrame matches computeMetrics at the key frames', () => {
    for (const view of ['face_on', 'down_the_line'] as const) {
      const { seq, club, keyframes, metrics, ctx } = analyse({ view, noise: 0 });
      const addr = keyframes.find((k) => k.position === 'address')!;
      for (const k of keyframes) {
        const live = metricsAtFrame(seq, k.frameIndex, addr.frameIndex, k.position, club, null, ctx);
        for (const v of live) {
          // computeMetrics reads the club at the sub-frame event time (it turns ~20°/frame near impact)
          if (['shaft_lean', 'hands_ahead', 'lead_wrist_hinge', 'shaft_plane_dev'].includes(v.id)) continue;
          const ref = getMetric(metrics, v.id, v.at);
          expect(ref, `${v.id}@${v.at}`).toBeDefined();
          // DTL turn proxies use the body width seen over the whole clip, live only the default ratio
          const turn = v.id === 'shoulder_turn' || v.id === 'hip_turn' || v.id === 'x_factor';
          if (turn && ctx.view === 'down_the_line') continue;
          const tol = v.unit === 'deg' ? (turn ? 8 : 4) : v.unit === 'pct_torso' ? 4 : 0.05;
          expect(Math.abs(ref!.value - v.value), `${v.id}@${v.at}`).toBeLessThan(tol);
        }
      }
    }
  });

  it('computeMetrics without key frames detects them itself', () => {
    const s = synthSwing({ view: 'down_the_line' });
    const m = computeMetrics(s.seq, s.truth.club, [], null, { view: 'down_the_line', shotType: 'iron', handedness: 'right' });
    expect(m.values.length).toBeGreaterThan(5);
  });
});

describe('fault catalog on top of the metrics (club as a working tracker would deliver it)', () => {
  const quality = { score: 1, detectedFrameRatio: 1, meanVisibility: 1, fps: 60, issues: [] };
  const faults = (o: Partial<SynthParams>) => {
    const a = analyse(o);
    return { ...a, ids: evaluateFaults(a.metrics, a.keyframes, quality, a.ctx).faults.map((f) => f.defId) };
  };
  // Known differences between the synthetic default swing and catalog thresholds are listed in
  // docs/coach/decisions/phases-metrics.md (casting, head_sway, flying_elbow, putt_wrist_break, flip_at_impact …).
  it('ideal swings do not show the knob faults, typical faults are found', () => {
    const ideal = faults(DTL);
    for (const id of ['early_extension', 'shaft_steep_downswing9', 'shaft_flat_downswing9', 'over_the_top', 'short_shoulder_turn'])
      expect(ideal.ids).not.toContain(id);
    expect(computeSwingScore(ideal.metrics, ideal.ctx, { level: 1, fps: 60 })!.total).toBeGreaterThanOrEqual(85);
    const fo = faults(FO).ids;
    for (const id of ['hip_sway', 'chicken_wing', 'reverse_pivot', 'weight_back', 'tempo_fast', 'tempo_slow']) expect(fo).not.toContain(id);
    const bad = faults({ ...DTL, shaftPlaneDevDown: 15, spineTiltImpactDelta: -12, hipDepthImpact: 0.08 }).ids;
    expect(bad).toContain('early_extension');
    expect(bad).toContain('shaft_steep_downswing9');
    expect(faults({ ...FO, hipShiftTop: -0.09 }).ids).toContain('hip_sway');
    expect(faults({ ...FO, leadElbowFollow: 70 }).ids).toContain('chicken_wing');
    const putt = faults({ ...FO, shotType: 'putt', puttWristBreak: 20, strokeBodySway: 0.05 }).ids;
    expect(putt).toContain('putt_wrist_break');
    expect(putt).toContain('putt_body_movement');
  });
});
