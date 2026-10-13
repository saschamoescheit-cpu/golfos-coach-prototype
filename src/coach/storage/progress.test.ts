import { describe, expect, it } from 'vitest';
import { faultProgress, faultSeries, progressOverview, progressRecordsFor } from './progress';
import { fakeFault, fakeSwing, rowsFromPattern } from './testFixtures';

describe('progressRecordsFor', () => {
  it('one row per checked fault, detected or not; uncertain faults produce no row', () => {
    const s = fakeSwing('s', {
      faults: [fakeFault('early_extension', 0.7)],
      checkedFaultIds: ['early_extension', 'sway'],
      uncertainFaultIds: ['casting'],
    });
    const rows = progressRecordsFor(s);
    expect(rows.map((r) => [r.faultId, r.detected, r.severity])).toEqual([
      ['early_extension', true, 0.7],
      ['sway', false, 0],
    ]);
  });
});

describe('faultSeries', () => {
  it('orders by time and computes the rolling detection rate', () => {
    const rows = rowsFromPattern('f', 'xx..').reverse(); // input order must not matter
    const pts = faultSeries(rows, 'f', 2);
    expect(pts.map((p) => p.detected)).toEqual([true, true, false, false]);
    expect(pts.map((p) => p.rollingRate)).toEqual([1, 1, 0.5, 0]);
  });

  it('ignores other faults and keeps one point per swing', () => {
    const rows = [...rowsFromPattern('f', 'x.'), ...rowsFromPattern('g', 'xx'), { ...rowsFromPattern('f', 'x')[0], detected: false }];
    const pts = faultSeries(rows, 'f');
    expect(pts.length).toBe(2);
    expect(pts[0].detected).toBe(false); // last row for swing s0 wins
  });
});

describe('faultProgress', () => {
  it('"6 of the last 10 → 3 of the last 10" is an improvement', () => {
    const p = faultProgress(rowsFromPattern('ee', 'xxxxxx....' + 'xxx.......'), 'ee');
    expect(p.previous).toEqual({ detected: 6, total: 10 });
    expect(p.recent).toEqual({ detected: 3, total: 10 });
    expect(p.trend).toBe('improving');
    expect(p.recentSeverity).toBeCloseTo(0.6);
  });

  it('more often recently = worse; small differences = same', () => {
    expect(faultProgress(rowsFromPattern('f', '.........x' + 'xxxx......'), 'f').trend).toBe('worse');
    expect(faultProgress(rowsFromPattern('f', 'xxx.......' + 'xxxx......'), 'f').trend).toBe('same');
  });

  it('not enough swings → unknown', () => {
    expect(faultProgress(rowsFromPattern('f', 'xxxx'), 'f').trend).toBe('unknown');
    expect(faultProgress(rowsFromPattern('f', 'xx' + '..........'), 'f', 10).trend).toBe('unknown');
    const empty = faultProgress([], 'f');
    expect(empty).toMatchObject({ recent: { detected: 0, total: 0 }, previous: null, trend: 'unknown', lastTs: 0 });
  });
});

describe('progressOverview', () => {
  it('lists faults that showed up at least once, most frequent first, filtered by shot type', () => {
    const rows = [
      ...rowsFromPattern('rare', 'x.........'),
      ...rowsFromPattern('often', 'xxxxx.....'),
      ...rowsFromPattern('never', '..........'),
      ...rowsFromPattern('driverOnly', 'xxxxxxxxxx', 'driver', 100_000),
    ];
    expect(progressOverview(rows, { shotType: 'iron' }).map((p) => p.faultId)).toEqual(['often', 'rare']);
    expect(progressOverview(rows).map((p) => p.faultId)[0]).toBe('driverOnly');
  });
});
