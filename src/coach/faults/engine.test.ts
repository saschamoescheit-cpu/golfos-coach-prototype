import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import type { FaultDef, Swing } from '../model/types';
import { applicableFaults, correctionFor, evaluateFaults, frameOf, phaseWindow, skeletonStatus, topFaults } from './engine';
import { keyframes, metrics, mv, quality } from './testUtils';

const DTL_IRON: AnalysisContext = { shotType: 'iron', view: 'down_the_line', handedness: 'right' };
const FO_IRON: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
const kf = keyframes();

describe('evaluateFaults', () => {
  it('detects early extension DTL, with marker frame and measured values', () => {
    const r = evaluateFaults(metrics(mv('hip_depth_change', 'impact', 16, 0.9, 'pct_torso'), mv('spine_angle_change', 'impact', -2)), kf, quality(), DTL_IRON);
    const ee = r.faults.find((f) => f.defId === 'early_extension')!;
    expect(ee).toBeDefined();
    expect(ee.severity).toBeCloseTo(8 / 12, 2);
    expect(ee.priority).toBeCloseTo((8 / 12) * 5 * 0.9, 2);
    expect(ee.frameIndex).toBe(56);
    expect(ee.measured.map((m) => m.metric).sort()).toEqual(['hip_depth_change', 'spine_angle_change']);
    expect(r.checked).toContain('early_extension');
  });

  it('values inside tolerance → checked, not detected', () => {
    const r = evaluateFaults(metrics(mv('hip_depth_change', 'impact', 2), mv('spine_angle_change', 'impact', -1)), kf, quality(), DTL_IRON);
    expect(r.faults.find((f) => f.defId === 'early_extension')).toBeUndefined();
    expect(r.checked).toContain('early_extension');
    expect(r.uncertain).not.toContain('early_extension');
  });

  it('missing metric → uncertain, never "fine"', () => {
    const r = evaluateFaults(metrics(), kf, quality(), DTL_IRON);
    expect(r.faults).toEqual([]);
    expect(r.checked).toEqual([]);
    expect(r.uncertain).toContain('early_extension');
    expect(r.uncertain).toContain('shaft_steep_downswing9');
  });

  it('low confidence (hand-estimated club 0.4) → uncertain', () => {
    const r = evaluateFaults(metrics(mv('shaft_plane_dev', 'downswing9', 14, 0.4)), kf, quality(), DTL_IRON);
    expect(r.faults.find((f) => f.defId === 'shaft_steep_downswing9')).toBeUndefined();
    expect(r.uncertain).toContain('shaft_steep_downswing9');
  });

  it('any-match: one rule ok + one unknown → uncertain; one hit → detected', () => {
    const okOnly = evaluateFaults(metrics(mv('hip_depth_change', 'impact', 1)), kf, quality(), DTL_IRON);
    expect(okOnly.uncertain).toContain('early_extension');
    const hit = evaluateFaults(metrics(mv('spine_angle_change', 'impact', -12)), kf, quality(), DTL_IRON);
    expect(hit.faults.map((f) => f.defId)).toContain('early_extension');
  });

  it('wrong view or shot type is ignored completely', () => {
    // face-on: early extension (DTL only) is neither checked nor uncertain
    const fo = evaluateFaults(metrics(mv('hip_depth_change', 'impact', 30)), kf, quality(), FO_IRON);
    expect([...fo.checked, ...fo.uncertain]).not.toContain('early_extension');
    expect(fo.faults.map((f) => f.defId)).not.toContain('early_extension');
    // putt: no full-swing faults
    const putt = evaluateFaults(metrics(mv('tempo_ratio', 'swing', 1.2, 0.9, 'ratio')), kf, quality(), { ...FO_IRON, shotType: 'putt' });
    expect(putt.faults.map((f) => f.defId)).toEqual(['putt_tempo']);
    expect([...putt.checked, ...putt.uncertain].every((id) => id.startsWith('putt_'))).toBe(true);
  });

  it('rules whose metric does not exist in the view are skipped (putt head DTL uses only head_shift_y)', () => {
    const r = evaluateFaults(metrics(mv('head_shift_y', 'impact', 1, 0.9, 'pct_torso')), kf, quality(), { ...DTL_IRON, shotType: 'putt' });
    expect(r.checked).toContain('putt_head_movement');
  });

  it('quality below QUALITY_MIN → nothing diagnosed, all applicable faults uncertain', () => {
    const r = evaluateFaults(metrics(mv('hip_depth_change', 'impact', 30)), kf, quality(0.3), DTL_IRON);
    expect(r.faults).toEqual([]);
    expect(r.uncertain).toEqual(applicableFaults(DTL_IRON).map((f) => f.id));
  });

  it('sorts by priority = severity × importance × confidence and topFaults returns 3', () => {
    const r = evaluateFaults(
      metrics(
        mv('shaft_plane_dev', 'downswing9', 15, 0.9), // importance 5, severity 1
        mv('hand_path_shift', 'downswing9', 12, 0.9, 'pct_torso'), // importance 5, severity ~0.24
        mv('trail_arm_angle', 'top', 150, 0.9), // importance 2, severity 1
        mv('spine_angle', 'address', 20, 0.9), // importance 2, severity 0.4
        mv('shoulder_turn', 'top', 30, 0.7), // importance 3, severity 1, conf 0.7 → 2.1
      ),
      kf,
      quality(),
      DTL_IRON,
    );
    const p = r.faults.map((f) => f.priority);
    expect(p).toEqual([...p].sort((a, b) => b - a));
    expect(r.faults[0].defId).toBe('shaft_steep_downswing9');
    const top = topFaults(r.faults);
    expect(top).toHaveLength(3);
    expect(top.map((f) => f.defId).slice(0, 2)).toEqual(['shaft_steep_downswing9', 'short_shoulder_turn']);
  });

  it("'outside' op and 'all' match", () => {
    const def: FaultDef = {
      id: 't', name: { en: 'T', de: 'T' }, shotTypes: ['iron'], views: ['down_the_line'], match: 'all', marker: 'top', importance: 2,
      rules: [
        { metric: 'spine_angle', at: 'address', op: 'outside', threshold: 25, thresholdHigh: 40, fullSeverityAt: 10, review: 'REVIEW(golf): t' },
        { metric: 'knee_flex', at: 'address', op: '<', threshold: 10, fullSeverityAt: 10, review: 'REVIEW(golf): t' },
      ],
      ballFlights: [], ballEffect: { en: '', de: '' }, cause: { en: '', de: '' }, correction: { en: '', de: '' }, benefit: { en: '', de: '' }, drillIds: [],
    };
    const both = evaluateFaults(metrics(mv('spine_angle', 'address', 45), mv('knee_flex', 'address', 5)), kf, quality(), DTL_IRON, [def]);
    expect(both.faults[0].severity).toBeCloseTo(0.5, 5);
    const one = evaluateFaults(metrics(mv('spine_angle', 'address', 45), mv('knee_flex', 'address', 20)), kf, quality(), DTL_IRON, [def]);
    expect(one.faults).toEqual([]);
    expect(one.checked).toEqual(['t']);
    const missing = evaluateFaults(metrics(mv('spine_angle', 'address', 45)), kf, quality(), DTL_IRON, [def]);
    expect(missing.uncertain).toEqual(['t']);
  });
});

describe('helpers', () => {
  it('frameOf falls back to the nearest key position', () => {
    expect(frameOf(keyframes({ address: 0, top: 30, impact: 40 }), 'downswing9')).toBe(30);
    expect(frameOf([], 'top')).toBe(0);
  });
  it('correctionFor returns correction, benefit and drills', () => {
    const c = correctionFor('over_the_top')!;
    expect(c.text.en.length).toBeGreaterThan(10);
    expect(c.benefit.de.length).toBeGreaterThan(10);
    expect(c.drillIds.length).toBeGreaterThan(0);
    expect(correctionFor('nope')).toBeUndefined();
  });
  it('phaseWindow spans half-way to neighbouring key positions', () => {
    expect(phaseWindow(kf, 'impact', 100)).toEqual([53, 68]);
    expect(phaseWindow(kf, 'address', 100)).toEqual([0, 10]);
    expect(phaseWindow(kf, 'swing', 100)).toEqual([0, 99]);
  });
});

describe('skeletonStatus (US-1.3)', () => {
  const m = metrics(mv('spine_angle', 'address', 30), mv('hip_depth_change', 'impact', 16), mv('spine_angle_change', 'impact', -10));
  const ev = evaluateFaults(m, kf, quality(), DTL_IRON);
  const swing = {
    pose: { frames: Array.from({ length: 100 }, (_, i) => ({ t: i, lm: null })), width: 1, height: 1, fps: 60, mirrored: false },
    keyframes: kf,
    metrics: m,
    faults: ev.faults,
  } as unknown as Swing;

  it('spine line green at address, red around impact when standing up', () => {
    expect(skeletonStatus(swing, 0)['11-23']).toBe('ok');
    expect(skeletonStatus(swing, 56)['11-23']).toBe('bad');
    expect(skeletonStatus(swing, 56)['23-24']).toBe('bad');
  });
  it('lines without measurement stay neutral', () => {
    expect(skeletonStatus(swing, 56)['11-13']).toBeUndefined();
    expect(skeletonStatus(swing, 30)['11-23']).toBeUndefined();
  });
});
