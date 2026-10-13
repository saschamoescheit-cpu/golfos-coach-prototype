import { describe, expect, it } from 'vitest';
import { ballFlightGroups, diagnose, measurableCauses, MIN_SWINGS_FOR_DIAGNOSIS, type DiagnosisSwing } from './diagnosis';

const swing = (faults: [string, number][], checked: string[]): DiagnosisSwing => ({
  faults: faults.map(([defId, severity]) => ({ defId, severity })),
  checkedFaultIds: [...new Set([...checked, ...faults.map(([id]) => id)])],
});

describe('diagnose (US-1.12)', () => {
  it('without history: catalog order, not enough data, unmeasurable causes separate', () => {
    const r = diagnose('slice');
    expect(r.enoughData).toBe(false);
    expect(r.top).toHaveLength(3);
    expect(r.top[0].faultId).toBe('over_the_top');
    expect(r.top.every((c) => c.frequency === null)).toBe(true);
    expect(r.unmeasurable.length).toBeGreaterThan(0);
    expect(r.unmeasurable.every((c) => !c.measurable && !c.faultId)).toBe(true);
  });

  it('ranks causes by frequency and severity in the player’s swings', () => {
    const all = ['over_the_top', 'shaft_steep_downswing9', 'chicken_wing', 'reverse_pivot'];
    const history = [
      swing([['chicken_wing', 0.8]], all),
      swing([['chicken_wing', 0.6], ['over_the_top', 0.2]], all),
      swing([['chicken_wing', 0.7]], all),
      swing([], all),
      swing([['over_the_top', 0.3]], all),
      swing([], all),
    ];
    expect(history.length).toBeGreaterThanOrEqual(MIN_SWINGS_FOR_DIAGNOSIS);
    const r = diagnose('slice', history);
    expect(r.enoughData).toBe(true);
    expect(r.top.map((c) => c.faultId)).toEqual(['chicken_wing', 'over_the_top']);
    const cw = r.causes.find((c) => c.faultId === 'chicken_wing')!;
    expect(cw.frequency).toBeCloseTo(0.5, 5);
    expect(cw.meanSeverity).toBeCloseTo(0.7, 5);
    expect(cw.checked).toBe(6);
    // never checked (e.g. only face-on filmed) → frequency null, ranked after the occurring causes
    const never = r.causes.find((c) => c.faultId === 'shaft_flat_backswing9' || c.faultId === 'shaft_steep_backswing9')!;
    expect(never.frequency).toBeNull();
  });

  it('measurable causes include faults that list the flight', () => {
    const ids = measurableCauses('fat').map((c) => c.faultId);
    expect(ids).toContain('weight_back');
    expect(ids).toContain('setup_crouched'); // listed only on the fault side
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every ball flight belongs to a group', () => {
    expect(ballFlightGroups().reduce((n, g) => n + g.flights.length, 0)).toBe(26);
  });
});
