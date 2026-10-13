import { describe, expect, it } from 'vitest';
import { FAULTS, getFaultDef } from '../faults/catalog';
import { ALL_POSITIONS, LANDMARK_COUNT, SHOT_TYPES } from '../model/constants';
import type { Swing } from '../model/types';
import { MemoryStore } from '../storage/memory';
import { getStore, setStore } from '../storage';
import { synthSwing } from '../testing/synth';
import { METRIC_UNITS } from './metricInfo';
import {
  referenceCandidates,
  saveTarget,
  scaleTolerances,
  supportsMirror,
  targetFromFault,
  targetFromReference,
  targetFromTemplate,
  TEMPLATES,
  trainableFaults,
  withTolerance,
} from './targets';

describe('training targets', () => {
  it('templates are complete: label en+de, valid position, every criterion with unit and REVIEW(golf) note', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set<string>();
    for (const tpl of TEMPLATES) {
      expect(ids.has(tpl.id)).toBe(false);
      ids.add(tpl.id);
      expect(tpl.label.en && tpl.label.de).toBeTruthy();
      expect(ALL_POSITIONS).toContain(tpl.position);
      expect(SHOT_TYPES[tpl.shotType].positions).toContain(tpl.position);
      expect(tpl.criteria.length).toBeGreaterThan(0);
      for (const c of tpl.criteria) {
        expect(METRIC_UNITS[c.metric], c.metric).toBeDefined();
        expect(c.review).toMatch(/REVIEW\(golf\)/);
        expect(c.tolerance).toBeGreaterThan(0);
        expect(c.at === 'swing' || c.at === tpl.position).toBe(true);
      }
      const t = targetFromTemplate(tpl);
      expect(t.source).toBe('template');
      expect(t.ghost?.length).toBe(LANDMARK_COUNT);
    }
  });

  it('target from a correction of the fault catalog', () => {
    const def = getFaultDef('over_the_top')!;
    const t = targetFromFault(def, { shotType: 'driver', view: 'face_on' })!;
    expect(t.source).toBe('correction');
    expect(t.sourceId).toBe('over_the_top');
    expect(t.view).toBe('down_the_line'); // over the top is only measurable DTL
    expect(t.shotType).toBe('driver');
    expect(t.position).toBe('downswing9');
    expect(t.criteria).toEqual([{ metric: 'hand_path_shift', at: 'downswing9', target: 0, tolerance: 6, unit: 'pct_torso' }]);
    expect(supportsMirror(t)).toBe(true);
  });

  it('whole-swing corrections (tempo, chicken wing) are series-only', () => {
    const t = targetFromFault(getFaultDef('chicken_wing')!)!;
    expect(t.position).toBe('impact');
    expect(supportsMirror(t)).toBe(false);
  });

  it('every trainable fault of the catalog yields a target', () => {
    const list = trainableFaults(FAULTS);
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) {
      const t = targetFromFault(f, { withGhost: false });
      expect(t, f.id).not.toBeNull();
      expect(SHOT_TYPES[t!.shotType].positions, f.id).toContain(t!.position);
    }
  });

  it('target from a reference swing: position, measured values, ghost of that frame', () => {
    const s = synthSwing({ view: 'down_the_line' });
    const top = s.truth.keyframes.top!;
    const swing = {
      id: 'sw1',
      createdAt: Date.UTC(2026, 9, 12, 10),
      shotType: 'iron',
      view: 'down_the_line',
      pose: s.seq,
      keyframes: [
        { position: 'address', frameIndex: 0, t: 0, confidence: 1, method: 't' },
        { position: 'top', frameIndex: top, t: s.seq.frames[top].t, confidence: 1, method: 't' },
      ],
      metrics: {
        values: [
          { id: 'spine_angle_change', at: 'top', value: -2.04, unit: 'deg', confidence: 0.9 },
          { id: 'x_factor', at: 'top', value: 40, unit: 'deg', confidence: 0.9 },
          { id: 'shaft_plane_dev', at: 'top', value: 3, unit: 'deg', confidence: 0.2 },
          { id: 'hand_depth', at: 'top', value: 10, unit: 'pct_torso', confidence: 0.8 },
          { id: 'trail_arm_angle', at: 'top', value: 95, unit: 'deg', confidence: 0.8 },
          { id: 'spine_angle', at: 'top', value: 36, unit: 'deg', confidence: 0.8 },
        ],
      },
    } as unknown as Swing;
    // display-only and low-confidence values are left out
    expect(referenceCandidates(swing, 'top').map((c) => c.metric)).toEqual(['spine_angle_change', 'spine_angle', 'trail_arm_angle', 'hand_depth']);
    const t = targetFromReference(swing, 'top')!;
    expect(t.source).toBe('reference');
    expect(t.sourceId).toBe('sw1');
    expect(t.criteria.length).toBe(3);
    expect(t.criteria[0]).toMatchObject({ metric: 'spine_angle_change', target: -2, unit: 'deg' });
    expect(t.ghost![0].x).toBeCloseTo(s.seq.frames[top].lm![0].x);
    expect(t.label.de).toContain('Top');
    expect(targetFromReference(swing, 'top', ['trail_arm_angle'])!.criteria.map((c) => c.metric)).toEqual(['trail_arm_angle']);
    expect(targetFromReference(swing, 'finish')).toBeNull();
  });

  it('tolerances can be scaled per target and per criterion', () => {
    const t = targetFromTemplate(TEMPLATES[0], { withGhost: false });
    expect(scaleTolerances(t, 1.5).criteria[0].tolerance).toBeCloseTo(t.criteria[0].tolerance * 1.5);
    expect(withTolerance(t, 0, 4).criteria[0].tolerance).toBe(4);
    expect(withTolerance(t, 0, -1).criteria[0].tolerance).toBeGreaterThan(0);
  });

  it('saves targets in the store', async () => {
    setStore(new MemoryStore());
    await saveTarget(targetFromTemplate(TEMPLATES[0], { withGhost: false }));
    expect((await (await getStore()).listTargets()).map((t) => t.id)).toEqual([TEMPLATES[0].id]);
    setStore(null);
  });
});
