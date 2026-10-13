import { describe, expect, it } from 'vitest';
import { computeSwingScore } from '../faults/score';
import { metrics, mv } from '../faults/testUtils';
import type { Swing } from '../model/types';
import { dayKey, displayScore, levelUpSuggestion, median, scoreCurves, scoreUnits } from './scoreHistory';
import { fakeSwing } from './testFixtures';

const ctx = { shotType: 'iron' as const, view: 'down_the_line' as const, handedness: 'right' as const };
/** a stored score computed on `level`; shaft 9° steep at 9 o'clock down → depends strongly on the level */
function scored(id: string, createdAt: number, level: 1 | 2 | 3 | 4 | 5, shaft = 9, over: Partial<Swing> = {}): Swing {
  const score = computeSwingScore(
    metrics(mv('shaft_plane_dev', 'downswing9', shaft), mv('tempo_ratio', 'swing', 3), mv('shoulder_turn', 'top', 90),
      mv('shaft_plane_dev', 'top', 1), mv('shaft_plane_dev', 'backswing9', 0), mv('spine_angle', 'address', 30)),
    ctx,
    { level, fps: 240 },
  );
  return fakeSwing(id, { createdAt, score, ...over });
}
const DAY = 24 * 3600 * 1000;
const t0 = new Date(2026, 9, 1, 10).getTime();

describe('score history (review W7)', () => {
  it('displayScore recomputes a stored score for the current level', () => {
    const s = scored('a', t0, 1);
    const on5 = displayScore(s, 5)!;
    expect(on5.level).toBe(5);
    expect(on5.total!).toBeGreaterThan(s.score!.total!);
    expect(displayScore(s, 1)).toBe(s.score); // same level → stored score
    expect(displayScore(fakeSwing('x'), 3)).toBeNull();
  });

  it('median and day key', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(dayKey(t0)).toBe('2026-10-01');
  });

  it('units need ≥ 5 scored swings of one day and one profile', () => {
    const day1 = [0, 1, 2, 3, 4].map((i) => scored(`d1-${i}`, t0 + i * 60_000, 3));
    const day2 = [0, 1, 2, 3].map((i) => scored(`d2-${i}`, t0 + DAY + i * 60_000, 3)); // only 4
    const face = [0, 1, 2, 3, 4].map((i) => scored(`f-${i}`, t0 + i * 60_000, 3, 9, { view: 'face_on' }));
    const units = scoreUnits([...day1, ...day2, ...face], 3);
    expect(units.map((u) => `${u.day}/${u.view}/${u.n}`)).toEqual(['2026-10-01/down_the_line/5', '2026-10-01/face_on/5']);
    const curves = scoreCurves([...day1, ...day2], 3);
    expect(curves).toHaveLength(1);
    expect(curves[0].units).toHaveLength(1);
  });

  it('level-up is suggested when the median of the last 3 units on the own level is ≥ 85', () => {
    const unit = (d: number, shaft: number) => [0, 1, 2, 3, 4].map((i) => scored(`u${d}-${i}`, t0 + d * DAY + i * 60_000, 3, shaft));
    const good = [...unit(0, 1), ...unit(1, 1), ...unit(2, 1)];
    const sug = levelUpSuggestion(good, 3)!;
    expect(sug).toMatchObject({ from: 3, to: 2 });
    expect(sug.median).toBeGreaterThanOrEqual(85);
    expect(levelUpSuggestion(good.slice(0, 10), 3)).toBeNull(); // only 2 units
    expect(levelUpSuggestion(good, 1)).toBeNull(); // already the top level
    const weak = [...unit(0, 30), ...unit(1, 30), ...unit(2, 30)];
    expect(levelUpSuggestion(weak, 3)).toBeNull();
  });
});
