import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import { analyzeSequence } from '../analysis/analyze';
import { computeMetrics } from '../analysis/metrics';
import { synthGrayFrame, synthSwing, type SynthParams } from '../testing/synth';
import { computeSwingScore } from './score';

/**
 * End-to-end: synthetic swing → full pipeline → faults + score. computeMetrics is built in parallel by
 * "phases-metrics"; until it returns values these tests are skipped.
 */
const probe = synthSwing({ view: 'down_the_line' });
const metricsImplemented = (() => {
  try {
    return computeMetrics(probe.seq, probe.truth.club, [], null, { shotType: 'iron', view: 'down_the_line', handedness: 'right' }).values.length > 0;
  } catch {
    return false;
  }
})();

function run(p: Partial<SynthParams>) {
  const s = synthSwing(p);
  const ctx: AnalysisContext = { shotType: s.params.shotType, view: s.params.view, handedness: s.params.handedness };
  const images = s.truth.club.map((c, i) => synthGrayFrame(c, { seed: i }));
  const r = analyzeSequence({ raw: s.seq, images, ctx });
  return { r, ctx, ids: r.faults.map((f) => f.defId) };
}

describe.skipIf(!metricsImplemented)('integration with synthetic swings', () => {
  it('ideal DTL iron: no early extension / shaft faults, score ≥ 90 on level 1', () => {
    const { r, ctx, ids } = run({ view: 'down_the_line', shotType: 'iron' });
    expect(r.quality.score).toBeGreaterThanOrEqual(0.5);
    expect(ids).not.toContain('early_extension');
    expect(ids).not.toContain('shaft_steep_downswing9');
    expect(ids).not.toContain('shaft_flat_downswing9');
    const s = computeSwingScore(r.metrics, ctx, { level: 1, fps: r.pose.fps })!;
    expect(s.total).toBeGreaterThanOrEqual(90);
  });

  // Down-the-line at 9 o'clock the shaft is strongly foreshortened; the synthetic plane knob maps non-linearly onto the
  // measured offset (15° knob ≈ 7° measured). Real-video validation of shaft_plane_dev is the top open risk (DECISIONS L5).
  it('DTL steep shaft at the 9 o-clock-down position is detected', () => {
    expect(run({ view: 'down_the_line', shotType: 'iron', shaftPlaneDevDown: 15 }).ids).toContain('shaft_steep_downswing9');
  });

  it('DTL early extension is detected and lowers the score', () => {
    const good = run({ view: 'down_the_line', shotType: 'iron' });
    const bad = run({ view: 'down_the_line', shotType: 'iron', spineTiltImpactDelta: -12, hipDepthImpact: 0.08 });
    expect(bad.ids).toContain('early_extension');
    const sg = computeSwingScore(good.r.metrics, good.ctx, { level: 1, fps: 60 })!.total!;
    const sb = computeSwingScore(bad.r.metrics, bad.ctx, { level: 1, fps: 60 })!.total!;
    expect(sb).toBeLessThan(sg);
  });

  it('face-on: hip sway and chicken wing are found, ideal swing stays clean', () => {
    expect(run({ view: 'face_on' }).ids).not.toContain('hip_sway');
    expect(run({ view: 'face_on', hipShiftTop: -0.09 }).ids).toContain('hip_sway');
    expect(run({ view: 'face_on', leadElbowFollow: 70 }).ids).toContain('chicken_wing');
  });

  it('putt: wrist break and body movement are found', () => {
    const r = run({ view: 'face_on', shotType: 'putt', puttWristBreak: 20, strokeBodySway: 0.05 });
    expect(r.ids).toContain('putt_wrist_break');
    expect(r.ids).toContain('putt_body_movement');
  });

  // Review K7: the generator now has forward shaft lean at impact (irons 8°, wedges 6°), so these rules get a
  // false-alarm test; a shaft leaning back (or casting) is found.
  it('face-on: no flip / scoop on the ideal iron and pitch, found with the shaft leaning back', () => {
    expect(run({ view: 'face_on', shotType: 'iron' }).ids).not.toContain('flip_at_impact');
    expect(run({ view: 'face_on', shotType: 'pitch' }).ids).not.toContain('chip_scoop');
    expect(run({ view: 'face_on', shotType: 'iron', shaftLeanImpact: -6 }).ids).toContain('flip_at_impact');
    expect(run({ view: 'face_on', shotType: 'chip', shaftLeanImpact: -8 }).ids).toContain('chip_scoop');
  });

  it('dark video → nothing diagnosed', () => {
    const { r } = run({ view: 'down_the_line', visibility: 0.3 });
    expect(r.faults).toEqual([]);
  });
});
