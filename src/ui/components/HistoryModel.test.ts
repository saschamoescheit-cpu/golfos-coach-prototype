import { describe, expect, it } from 'vitest';
import { levelFromHandicap } from '../../coach/faults/score';
import type { PhaseKeyframe } from '../../coach/model/types';
import { faultProgress } from '../../coach/storage/progress';
import { fakeFault, fakeSwing, rowsFromPattern } from '../../coach/storage/testFixtures';
import { approxCm, commonPositions, compareRows, faultName, faultStatus, formatWhen, groupByShotType, progressSentence, shotTypeCounts, syncedFrame, topFault } from './HistoryModel';
import { clampTolerance, handicapInput, levelInfos, parseHandicap } from './SettingsModel';

const kf = (position: PhaseKeyframe['position'], frameIndex: number): PhaseKeyframe => ({ position, frameIndex, t: frameIndex * 33, confidence: 1, method: 'test' });

describe('history helpers', () => {
  it('groups by shot type, newest group first, swings newest first', () => {
    const g = groupByShotType([
      fakeSwing('i1', { shotType: 'iron', createdAt: 1 }),
      fakeSwing('d1', { shotType: 'driver', createdAt: 5 }),
      fakeSwing('i2', { shotType: 'iron', createdAt: 3 }),
    ]);
    expect(g.map((x) => [x.shotType, x.swings.map((s) => s.id)])).toEqual([
      ['driver', ['d1']],
      ['iron', ['i2', 'i1']],
    ]);
    expect(shotTypeCounts([fakeSwing('a', { shotType: 'putt' }), fakeSwing('b', { shotType: 'driver' })])).toEqual([
      { shotType: 'driver', count: 1 },
      { shotType: 'putt', count: 1 },
    ]);
  });

  it('top fault = highest priority; unknown fault ids are shown readable', () => {
    const s = fakeSwing('a', { faults: [fakeFault('x', 0.2), fakeFault('y', 0.9)] });
    expect(topFault(s)?.defId).toBe('y');
    expect(topFault(fakeSwing('b'))).toBeUndefined();
    expect(faultName('some_new_fault', 'en')).toBe('Some new fault');
  });

  it('fault status: clean only when faults were checked, otherwise unsure (review W5)', () => {
    expect(faultStatus(fakeSwing('a', { faults: [fakeFault('x', 0.5)] })).kind).toBe('fault');
    expect(faultStatus(fakeSwing('b', { checkedFaultIds: ['x'] })).kind).toBe('clean');
    expect(faultStatus(fakeSwing('c', { checkedFaultIds: [] })).kind).toBe('unsure');
  });

  it('progress sentence: "6 of 10 before → 3 of the last 10"', () => {
    const p = faultProgress(rowsFromPattern('f', 'xxxxxx....xxx.......'), 'f');
    expect(progressSentence(p, 'en')).toBe('6 of 10 before → 3 of the last 10');
    expect(progressSentence(p, 'de')).toBe('vorher 6 von 10 → 3 von den letzten 10');
    expect(progressSentence(faultProgress(rowsFromPattern('f', 'x..'), 'f'), 'en')).toBe('1 of the last 3');
  });

  it('formats dates relative to today', () => {
    const now = new Date(2026, 9, 13, 18, 0).getTime();
    expect(formatWhen(new Date(2026, 9, 13, 9, 5).getTime(), 'en', now)).toMatch(/^Today /);
    expect(formatWhen(new Date(2026, 9, 12, 9, 5).getTime(), 'de', now)).toMatch(/^Gestern /);
    expect(formatWhen(new Date(2026, 9, 1, 9, 5).getTime(), 'en', now)).toMatch(/Oct/);
  });

  it('compare: common key positions and synchronised frames', () => {
    const a = fakeSwing('a', { keyframes: [kf('address', 0), kf('top', 30), kf('impact', 40), kf('finish', 60)] });
    const b = fakeSwing('b', { keyframes: [kf('address', 10), kf('backswing9', 20), kf('top', 50), kf('impact', 58), kf('finish', 90)] });
    const pos = commonPositions(a, b);
    expect(pos).toEqual(['address', 'top', 'impact', 'finish']);
    expect([syncedFrame(a, pos, 1), syncedFrame(b, pos, 1)]).toEqual([30, 50]);
    expect([syncedFrame(a, pos, 0.5), syncedFrame(b, pos, 0.5)]).toEqual([15, 30]);
    expect(syncedFrame(b, pos, 3)).toBe(90);
    expect(syncedFrame(b, pos, 99)).toBe(90);
  });

  it('compare rows: union of both swings at a position, unsure values left out', () => {
    const v = (id: 'hip_turn' | 'shoulder_turn' | 'tempo_ratio', at: 'top' | 'swing', value: number, confidence = 0.9) => ({ id, at, value, unit: 'deg' as const, confidence });
    const a = fakeSwing('a', { metrics: { values: [v('hip_turn', 'top', 40), v('shoulder_turn', 'top', 80, 0.2), v('tempo_ratio', 'swing', 3)] } });
    const b = fakeSwing('b', { metrics: { values: [v('shoulder_turn', 'top', 90)] } });
    expect(compareRows(a, b, 'top')).toEqual([
      { metric: 'hip_turn', at: 'top', unit: 'deg', a: 40 },
      { metric: 'shoulder_turn', at: 'top', unit: 'deg', b: 90 },
    ]);
    expect(compareRows(a, b, 'swing').map((r) => r.metric)).toEqual(['tempo_ratio']);
  });

  it('approximate centimetres from torso percent', () => {
    expect(approxCm(10, 178)).toBe(5);
    expect(approxCm(-20, 180)).toBe(-10);
  });
});

describe('settings helpers', () => {
  it('parses handicaps incl. plus handicaps (stored negative)', () => {
    expect(parseHandicap('18,4', false)).toBe(18.4);
    expect(parseHandicap('2.3', true)).toBe(-2.3);
    expect(parseHandicap('+1', false)).toBe(-1);
    expect(parseHandicap('', false)).toBeNull();
    expect(parseHandicap('0', true)).toBe(0);
    expect(parseHandicap('55', false)).toBe('invalid');
    expect(parseHandicap('abc', false)).toBe('invalid');
    expect(parseHandicap('12', true)).toBe('invalid');
    expect(levelFromHandicap(parseHandicap('2.3', true) as number)).toBe(1);
    expect(handicapInput(-2.3, 'de')).toBe('2,3');
    expect(handicapInput(null, 'en')).toBe('');
  });

  it('level ranges come from the score config and cover 1..5', () => {
    const l = levelInfos();
    expect(l.map((x) => x.level)).toEqual([1, 2, 3, 4, 5]);
    expect(l[0].from).toBeNull();
    expect(l[1].from).toBe(l[0].to);
  });

  it('tolerance scale is clamped to 0.5–2', () => {
    expect(clampTolerance(0.1)).toBe(0.5);
    expect(clampTolerance(3)).toBe(2);
    expect(clampTolerance(1.04)).toBe(1);
  });
});
