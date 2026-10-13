import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import {
  combineParts,
  computeSwingScore,
  deviation,
  levelFromHandicap,
  levelFromSettings,
  pointsFor,
  rescore,
  SCORE_CONFIG,
  SCORE_VERSION,
  scoreColor,
} from './score';
import { metrics, mv } from './testUtils';

const DTL: AnalysisContext = { shotType: 'iron', view: 'down_the_line', handedness: 'right' };
const FO: AnalysisContext = { ...DTL, view: 'face_on' };

/** A near-ideal down-the-line iron swing. */
const idealDtl = () =>
  metrics(
    mv('shaft_plane_dev', 'downswing9', 1),
    mv('shaft_plane_dev', 'top', 2),
    mv('shaft_plane_dev', 'backswing9', -1),
    mv('tempo_ratio', 'swing', 3.0, 0.9, 'ratio'),
    mv('downswing_ms', 'swing', 250, 0.9, 'ms'),
    mv('shoulder_turn', 'top', 90),
    mv('spine_angle_change', 'impact', -1),
    mv('hip_turn', 'impact', -36),
    mv('spine_angle', 'address', 31),
  );

describe('point curve', () => {
  it('d = T → 100, 1.5T → 75, 2T → 50, 2.5T → 25, ≥ 3T → 0', () => {
    expect(pointsFor(0, 5)).toBe(100);
    expect(pointsFor(5, 5)).toBe(100);
    expect(pointsFor(7.5, 5)).toBe(75);
    expect(pointsFor(10, 5)).toBe(50);
    expect(pointsFor(12.5, 5)).toBe(25);
    expect(pointsFor(15, 5)).toBe(0);
    expect(pointsFor(40, 5)).toBe(0);
  });
  it('is continuous (no jumps at the band edges)', () => {
    for (const k of [1, 2, 3]) expect(Math.abs(pointsFor(k * 5 - 1e-6, 5) - pointsFor(k * 5 + 1e-6, 5))).toBeLessThan(1e-3);
  });
  it('one-sided target: only the short side counts', () => {
    expect(deviation('min', 95, 85)).toBe(0);
    expect(deviation('min', 70, 85)).toBe(15);
    expect(deviation('max', 70, 85)).toBe(0);
    expect(deviation('abs', 70, 85)).toBe(15);
  });
  it('colours: green ≥ 80, yellow 50–79, red < 50, grey = null', () => {
    expect([scoreColor(80), scoreColor(79), scoreColor(50), scoreColor(49), scoreColor(null)]).toEqual(['green', 'yellow', 'yellow', 'red', 'grey']);
  });
});

describe('total and weights', () => {
  it('weights are 30/20/18/14/10/8', () => {
    expect(SCORE_CONFIG.parts.map((p) => [p.id, p.weight])).toEqual([
      ['downswing9', 0.3], ['tempo', 0.2], ['body', 0.18], ['top', 0.14], ['backswing9', 0.1], ['setup', 0.08],
    ]);
  });
  it('concept example 70/85/60/80/90/95 → 77', () => {
    const w = SCORE_CONFIG.parts.map((p) => p.weight);
    expect(combineParts([70, 85, 60, 80, 90, 95].map((score, i) => ({ score, weight: w[i] }))).total).toBe(77);
  });
  it('redistributes missing weight when ≥ 80 % is measured', () => {
    const w = SCORE_CONFIG.parts.map((p) => p.weight);
    // setup (8 %) and backswing9 (10 %) missing → 82 % measured
    const r = combineParts([70, 85, 60, 80, null, null].map((score, i) => ({ score, weight: w[i] })));
    expect(r.coverage).toBeCloseTo(0.82, 5);
    expect(r.total).toBe(Math.round((0.3 * 70 + 0.2 * 85 + 0.18 * 60 + 0.14 * 80) / 0.82));
  });
  it('below 80 % → total null', () => {
    const w = SCORE_CONFIG.parts.map((p) => p.weight);
    expect(combineParts([null, 85, 60, 80, 90, 95].map((score, i) => ({ score, weight: w[i] }))).total).toBeNull();
  });
});

describe('computeSwingScore', () => {
  it('ideal DTL swing scores ≥ 90 on level 1 and stores version, level, raw criteria', () => {
    const s = computeSwingScore(idealDtl(), DTL, { level: 1, fps: 120 })!;
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(s.tourTotal).toBe(s.total);
    expect(s.version).toBe(SCORE_VERSION);
    expect(s.level).toBe(1);
    expect(s.coverage).toBeCloseTo(1 - 0, 5);
    expect(s.criteria!.find((c) => c.metric === 'hip_shift_x')!.reason).toBe('view');
    expect(s.criteria!.find((c) => c.metric === 'side_bend')!.reason).toBe('view');
  });

  it('face-on alone → total null (coverage), part scores still there', () => {
    const s = computeSwingScore(
      metrics(mv('tempo_ratio', 'swing', 3), mv('shoulder_turn', 'top', 90), mv('hip_shift_x', 'top', 2), mv('side_bend', 'address', 15)),
      FO,
      { level: 3 },
    )!;
    expect(s.total).toBeNull();
    expect(s.noTotalReason).toBe('coverage');
    expect(s.coverage).toBeCloseTo(0.46, 5);
    expect(s.parts.find((p) => p.id === 'tempo')!.score).toBe(100);
    expect(s.parts.find((p) => p.id === 'setup')!.score).toBe(100);
    expect(s.parts.find((p) => p.id === 'downswing9')!.score).toBeNull();
  });

  it('only driver and iron get a score (reason shot_type)', () => {
    const s = computeSwingScore(idealDtl(), { ...DTL, shotType: 'pitch' })!;
    expect(s.total).toBeNull();
    expect(s.noTotalReason).toBe('shot_type');
    expect(computeSwingScore(idealDtl(), { ...DTL, shotType: 'driver' })!.total).not.toBeNull();
  });

  it('level: shaft 9° steep at 9 o’clock down → level 1 = 60, level 5 = 100', () => {
    const m = metrics(mv('shaft_plane_dev', 'downswing9', 9));
    const crit = (lvl: 1 | 5) => computeSwingScore(m, DTL, { level: lvl })!.criteria!.find((c) => c.metric === 'shaft_plane_dev' && c.at === 'downswing9')!;
    expect(crit(1).points).toBe(60);
    expect(crit(1).status).toBe('yellow');
    expect(crit(5).points).toBe(100);
    expect(crit(5).status).toBe('green');
    expect(crit(5).target).toBe(0);
  });

  it('handicap → level', () => {
    expect(levelFromHandicap(3)).toBe(1);
    expect(levelFromHandicap(-2)).toBe(1);
    expect(levelFromHandicap(4.0)).toBe(1);
    expect(levelFromHandicap(4.1)).toBe(2);
    expect(levelFromHandicap(18)).toBe(3);
    expect(levelFromHandicap(36)).toBe(4);
    expect(levelFromHandicap(54)).toBe(5);
    expect(levelFromHandicap(null)).toBe(3);
    expect(levelFromSettings({ handicap: 30, scoreLevel: 2 })).toBe(2);
    expect(levelFromSettings({ handicap: 30, scoreLevel: 'auto' })).toBe(4);
  });

  it('shaft with confidence 0.4 (hand estimate) is not scored', () => {
    const s = computeSwingScore(metrics(mv('shaft_plane_dev', 'downswing9', 0, 0.4)), DTL, { level: 1 })!;
    const c = s.criteria!.find((x) => x.at === 'downswing9')!;
    expect(c.points).toBeNull();
    expect(c.reason).toBe('low_confidence');
    expect(s.parts.find((p) => p.id === 'downswing9')!.score).toBeNull();
  });

  it('tempo at 30 fps (downswing 250 ms): not scored on level 1, scored on level 3', () => {
    const m = metrics(mv('tempo_ratio', 'swing', 3.1), mv('downswing_ms', 'swing', 250, 0.9, 'ms'));
    const t = (level: 1 | 3) => computeSwingScore(m, DTL, { level, fps: 30 })!.criteria!.find((c) => c.metric === 'tempo_ratio')!;
    expect(t(1).reason).toBe('below_measurement_floor');
    expect(t(1).floor).toBeCloseTo(0.4, 5);
    expect(t(3).points).toBe(100);
  });

  it('personal target (shoulder turn 70°) replaces 85°, but not on the tour scale', () => {
    const m = metrics(mv('shoulder_turn', 'top', 72));
    const std = computeSwingScore(m, DTL, { level: 1 })!;
    const pers = computeSwingScore(m, DTL, { level: 1, personalTargets: { 'shoulder_turn@top': 70 } })!;
    expect(std.criteria!.find((c) => c.metric === 'shoulder_turn')!.points).toBeLessThan(100);
    const pc = pers.criteria!.find((c) => c.metric === 'shoulder_turn')!;
    expect(pc.target).toBe(70);
    expect(pc.points).toBe(100);
  });

  it('rescore with another level from stored raw values = fresh computation', () => {
    const m = idealDtl();
    m.values.push(mv('shaft_plane_dev', 'downswing9', 11));
    m.values.splice(0, 1); // replace the ideal downswing9 value
    const stored = computeSwingScore(m, DTL, { level: 1, fps: 60 })!;
    const fresh = computeSwingScore(m, DTL, { level: 4, fps: 60 })!;
    expect(rescore(stored, DTL, { level: 4 })).toEqual(fresh);
    expect(rescore(stored, DTL, { level: 1 })).toEqual(stored);
  });

  it('is deterministic', () => {
    expect(computeSwingScore(idealDtl(), DTL, { level: 2, fps: 60 })).toEqual(computeSwingScore(idealDtl(), DTL, { level: 2, fps: 60 }));
  });

  it('low quality → total null with reason quality', () => {
    const s = computeSwingScore(idealDtl(), DTL, { quality: 0.3 })!;
    expect(s.total).toBeNull();
    expect(s.noTotalReason).toBe('quality');
  });

  it('a faulty swing (steep shaft, early extension) scores clearly lower', () => {
    const bad = idealDtl();
    bad.values = bad.values.map((v) =>
      v.id === 'shaft_plane_dev' && v.at === 'downswing9' ? { ...v, value: 14 } : v.id === 'spine_angle_change' ? { ...v, value: -12 } : v,
    );
    const good = computeSwingScore(idealDtl(), DTL, { level: 1 })!.total!;
    expect(computeSwingScore(bad, DTL, { level: 1 })!.total!).toBeLessThan(good - 25);
  });
});
