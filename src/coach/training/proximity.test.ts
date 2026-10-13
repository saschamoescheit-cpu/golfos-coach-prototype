import { describe, expect, it } from 'vitest';
import type { MetricValue, TargetCriterion } from '../model/types';
import {
  BORDER_PROXIMITY,
  colorForProximity,
  COLORS,
  criterionDistance,
  evaluateCriteria,
  proximityFromDistance,
} from './proximity';

const arm: TargetCriterion = { metric: 'lead_arm_angle', at: 'top', target: 170, tolerance: 10, unit: 'deg' };
const turn: TargetCriterion = { metric: 'shoulder_turn', at: 'top', target: 80, tolerance: 10, unit: 'deg' };
const mv = (id: MetricValue['id'], value: number, confidence = 0.9): MetricValue => ({ id, at: 'top', value, unit: 'deg', confidence });

describe('proximity', () => {
  it('distance is measured in tolerances and scaled by the global toleranceScale', () => {
    expect(criterionDistance(arm, 170)).toBe(0);
    expect(criterionDistance(arm, 160)).toBe(1);
    expect(criterionDistance(arm, 200)).toBe(3);
    expect(criterionDistance(arm, 150, 2)).toBe(1);
  });

  it('proximity: 1 on target, 2/3 at the tolerance border, 0 from three tolerances on', () => {
    expect(proximityFromDistance(0)).toBe(1);
    expect(proximityFromDistance(1)).toBeCloseTo(BORDER_PROXIMITY);
    expect(proximityFromDistance(3)).toBe(0);
    expect(proximityFromDistance(10)).toBe(0);
    expect(proximityFromDistance(Infinity)).toBe(0);
  });

  it('hit only when all criteria are inside; overall proximity = weakest criterion', () => {
    const ev = evaluateCriteria([arm, turn], [mv('lead_arm_angle', 168), mv('shoulder_turn', 95)]);
    expect(ev.criteria[0].within).toBe(true);
    expect(ev.criteria[1].within).toBe(false);
    expect(ev.hit).toBe(false);
    expect(ev.maxDistance).toBeCloseTo(1.5);
    expect(ev.proximity).toBeCloseTo(proximityFromDistance(1.5));
    expect(ev.criteria[1].direction).toBe(1);

    const ok = evaluateCriteria([arm, turn], [mv('lead_arm_angle', 168), mv('shoulder_turn', 85)]);
    expect(ok.hit).toBe(true);
  });

  it('a wider toleranceScale turns a miss into a hit', () => {
    expect(evaluateCriteria([turn], [mv('shoulder_turn', 95)]).hit).toBe(false);
    expect(evaluateCriteria([turn], [mv('shoulder_turn', 95)], 1.6).hit).toBe(true);
  });

  it('missing or low-confidence values: no hit, proximity only from measured criteria', () => {
    const ev = evaluateCriteria([arm, turn], [mv('lead_arm_angle', 170), mv('shoulder_turn', 80, 0.1)]);
    expect(ev.missing).toBe(1);
    expect(ev.hit).toBe(false);
    expect(ev.proximity).toBe(1);
    const none = evaluateCriteria([arm], []);
    expect(none.proximity).toBeNull();
    expect(none.maxDistance).toBe(Infinity);
  });

  it('accepts a lookup function', () => {
    const ev = evaluateCriteria([arm], (m) => (m === 'lead_arm_angle' ? 171 : null));
    expect(ev.hit).toBe(true);
  });

  it('colours: green exactly inside the tolerance, red → yellow outside, grey when unknown', () => {
    expect(colorForProximity(1)).toBe(COLORS.green);
    expect(colorForProximity(proximityFromDistance(1))).toBe(COLORS.green);
    expect(colorForProximity(proximityFromDistance(1.01))).not.toBe(COLORS.green);
    expect(colorForProximity(0)).toBe(COLORS.red);
    expect(colorForProximity(BORDER_PROXIMITY - 1e-6)).toBe(COLORS.yellow);
    expect(colorForProximity(null)).toBe(COLORS.unknown);
  });
});
