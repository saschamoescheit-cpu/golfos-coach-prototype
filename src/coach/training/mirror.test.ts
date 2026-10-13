import { describe, expect, it } from 'vitest';
import { MirrorMachine, type MirrorEvent } from './mirror';

/** Run a distance timeline through the machine with a fake 30 fps clock. */
function run(m: MirrorMachine, segments: [number, number][], fps = 30, t0 = 0) {
  const events: { t: number; e: MirrorEvent }[] = [];
  let t = t0;
  for (const [ms, d] of segments) {
    const end = t + ms;
    for (; t < end; t += 1000 / fps) {
      for (const e of m.update(t, d).events) events.push({ t, e });
    }
  }
  return { events, t };
}
const kinds = (ev: { e: MirrorEvent }[]) => ev.map((x) => x.e);

describe('mirror mode state machine', () => {
  it('out → in (reach tone) → held after 2 s (held tone) → out without tone', () => {
    const m = new MirrorMachine();
    const { events } = run(m, [
      [1000, 2.5],
      [2600, 0.5],
      [1000, 2],
    ]);
    expect(kinds(events)).toEqual(['reach', 'held', 'leave']);
    const reach = events[0].t;
    const held = events[1].t;
    expect(reach).toBeGreaterThanOrEqual(1000);
    expect(reach).toBeLessThan(1000 + 200);
    expect(held - reach).toBeGreaterThanOrEqual(2000);
    expect(held - reach).toBeLessThan(2100);
  });

  it('no continuous tone: holding for 10 s gives exactly one reach and one held', () => {
    const m = new MirrorMachine();
    const { events } = run(m, [[10000, 0.2]]);
    expect(kinds(events)).toEqual(['reach', 'held']);
    expect(m.current).toBe('held');
  });

  it('hysteresis: jitter around the tolerance border does not flicker', () => {
    const m = new MirrorMachine();
    run(m, [[500, 0.9]]);
    expect(m.current).toBe('in');
    // jitter between 0.95 and 1.1 (inside the exit band) for 3 s → stays in, reaches held
    const ev: MirrorEvent[] = [];
    for (let i = 0; i < 90; i++) ev.push(...m.update(500 + i * 33.3, i % 2 ? 1.1 : 0.95).events);
    expect(ev).toEqual(['held']);
    expect(m.current).toBe('held');
  });

  it('a single bad frame does not end the hold; a sustained one does', () => {
    const m = new MirrorMachine();
    run(m, [[500, 0.5]]);
    expect(m.update(600, 5).state).toBe('in');
    expect(m.update(633, 0.5).state).toBe('in');
    const { events } = run(m, [[400, 5]], 30, 700);
    expect(kinds(events)).toEqual(['leave']);
    expect(m.current).toBe('out');
  });

  it('a lost pose (null) counts as outside', () => {
    const m = new MirrorMachine();
    run(m, [[500, 0.5]]);
    for (let t = 600; t < 1000; t += 33) m.update(t, null);
    expect(m.current).toBe('out');
  });

  it('entering needs a short dwell; a one-frame touch gives no tone', () => {
    const m = new MirrorMachine();
    expect(m.update(0, 0.5).events).toEqual([]);
    expect(m.update(33, 3).events).toEqual([]);
    expect(m.current).toBe('out');
  });

  it('re-entering right after leaving does not beep again within the cooldown', () => {
    const m = new MirrorMachine({ exitDwellMs: 0, enterDwellMs: 0 });
    expect(m.update(0, 0.5).events).toEqual(['reach']);
    expect(m.update(100, 2).events).toEqual(['leave']);
    expect(m.update(200, 0.5).events).toEqual([]);
    expect(m.current).toBe('in');
    m.update(300, 2);
    expect(m.update(1000, 0.5).events).toEqual(['reach']);
  });

  it('hold progress runs 0 → 1 over the 2 s', () => {
    const m = new MirrorMachine({ enterDwellMs: 0 });
    m.update(0, 0.5);
    expect(m.update(1000, 0.5).holdProgress).toBeCloseTo(0.5);
    expect(m.update(2500, 0.5).holdProgress).toBe(1);
  });
});
