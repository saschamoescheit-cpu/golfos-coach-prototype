import { describe, expect, it } from 'vitest';
import type { AnalysisInput, AnalysisResult } from '../analysis/analyze';
import type { AnalysisContext } from '../analysis/context';
import { computeMetrics } from '../analysis/metrics';
import { getFaultDef } from '../faults/catalog';
import { SwingTrigger, type TriggerEvent } from '../live/swingTrigger';
import type { PoseFrame, TrainingTarget } from '../model/types';
import { synthSwing, type SynthParams } from '../testing/synth';
import { hitRate, outcomeOf, SeriesSession, shiftSequence, type SeriesUpdate } from './series';
import { targetFromFault } from './targets';
import { evaluateCriteria } from './proximity';

const ctx: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
const armTarget: TrainingTarget = {
  id: 't',
  label: { en: 'arm', de: 'Arm' },
  source: 'template',
  shotType: 'iron',
  view: 'face_on',
  position: 'top',
  criteria: [{ metric: 'lead_arm_angle', at: 'top', target: 170, tolerance: 10, unit: 'deg' }],
};

/** Fake analysis: reports the lead arm angle given per swing (keyed by the first frame time) – no real metrics needed. */
function fakeAnalyzer(values: Map<number, number | null>) {
  let calls = 0;
  const fn = ({ raw }: AnalysisInput): AnalysisResult => {
    calls++;
    const t0 = raw.frames[0]?.t ?? 0;
    const key = [...values.keys()].reduce((best, k) => (Math.abs(k - t0) < Math.abs(best - t0) ? k : best), Infinity);
    const v = values.get(key);
    return {
      pose: raw,
      club: raw.frames.map(() => null),
      neutralLine: null,
      keyframes: [],
      metrics: { values: v == null ? [] : [{ id: 'lead_arm_angle', at: 'top', value: v, unit: 'deg', confidence: 0.9 }] },
      quality: { score: 1, detectedFrameRatio: 1, meanVisibility: 1, fps: raw.fps, issues: [] },
      faults: [],
      checkedFaultIds: [],
      uncertainFaultIds: [],
      score: null,
    };
  };
  return { fn, calls: () => calls };
}

/** Synthetic frames at 30 fps from t0, with hand-made trigger events at given times. */
function frames(t0: number, ms: number): PoseFrame[] {
  const lm = synthSwing({}).seq.frames[0].lm!;
  const out: PoseFrame[] = [];
  for (let t = t0; t < t0 + ms; t += 1000 / 30) out.push({ t, lm });
  return out;
}

function feed(s: SeriesSession, fr: PoseFrame[], events: Record<number, TriggerEvent[]>): SeriesUpdate[] {
  const ups: SeriesUpdate[] = [];
  for (const f of fr) {
    const key = Object.keys(events)
      .map(Number)
      .find((k) => Math.abs(k - f.t) < 1000 / 60);
    const u = s.push(f, key != null ? events[key] : []);
    if (Object.keys(u).length) ups.push(u);
  }
  return ups;
}

const swingEvents = (start: number, opts: { practice?: boolean; addressAt?: number } = {}) => {
  // address still 2 s before the takeaway (start + 1000 pre-roll); impact 1.0 s after takeaway; finish 1.5 s later
  const takeaway = start + 1000;
  const impact = takeaway + 1000;
  const ev: Record<number, TriggerEvent[]> = {};
  ev[opts.addressAt ?? takeaway - 1500] = [{ type: 'address' }];
  ev[impact + 33] = [{ type: 'impact', startT: start, topT: impact - 250, impactT: impact }];
  ev[impact + 1600] = [{ type: 'swing', startT: start, topT: impact - 250, impactT: impact, endT: impact + 1600, practice: opts.practice ?? false }];
  return { ev, impact };
};

describe('ball series core', () => {
  it('judges a swing ≤ 2 s after impact, completes it at the swing event, keeps the tally', () => {
    const vals = new Map<number, number | null>([[1000, 168], [6000, 140], [11000, 172]]);
    const fa = fakeAnalyzer(vals);
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn, clock: () => 0 });
    const a = swingEvents(1000);
    const b = swingEvents(6000);
    const c = swingEvents(11000);
    const ups = feed(s, frames(0, 15000), { ...a.ev, ...b.ev, ...c.ev });
    const judged = ups.filter((u) => u.judged).map((u) => u.judged!);
    expect(judged.map((j) => j.outcome)).toEqual(['hit', 'miss', 'hit']);
    for (const [i, j] of judged.entries()) {
      expect(j.latencyMs).toBeLessThanOrEqual(2000);
      expect(j.latencyMs).toBeGreaterThanOrEqual(400);
      expect(j.impactT).toBe([a, b, c][i].impact);
      expect(j.n).toBe(i + 1);
    }
    const completed = ups.filter((u) => u.completed).map((u) => u.completed!);
    expect(completed.length).toBe(3);
    expect(completed[0].full).not.toBeNull();
    expect(completed[0].endT).toBe(a.impact + 1600);
    expect(s.tally).toEqual({ hits: 2, judged: 3, unknown: 0, practice: 0 });
    expect(hitRate(s.tally)).toBeCloseTo(2 / 3);
  });

  it('practice swings (short address) are ignored: no judgement, no video, counted separately', () => {
    const fa = fakeAnalyzer(new Map([[1000, 168]]));
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn });
    // address event only 200 ms before the takeaway → still ≈ 700 ms < 1 s → practice
    const p = swingEvents(1000, { practice: true, addressAt: 1800 });
    const ups = feed(s, frames(0, 5000), p.ev);
    expect(ups.some((u) => u.judged || u.completed)).toBe(false);
    expect(ups.some((u) => u.practiceIgnored)).toBe(true);
    expect(s.tally).toEqual({ hits: 0, judged: 0, unknown: 0, practice: 1 });
    expect(fa.calls()).toBe(0);
  });

  it('a swing judged as real but flagged practice by the trigger is retracted', () => {
    const fa = fakeAnalyzer(new Map([[1000, 168]]));
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn });
    const p = swingEvents(1000, { practice: true }); // long address, but trigger says practice (e.g. small amplitude)
    const ups = feed(s, frames(0, 5000), p.ev);
    expect(ups.some((u) => u.judged)).toBe(true);
    expect(ups.find((u) => u.retracted)).toBeTruthy();
    expect(s.tally.judged).toBe(0);
    expect(s.results).toEqual([]);
  });

  it('a swing guessed as practice but confirmed real is judged at the swing event', () => {
    const fa = fakeAnalyzer(new Map([[1000, 150]]));
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn });
    const p = swingEvents(1000, { practice: false, addressAt: 1800 });
    const ups = feed(s, frames(0, 5000), p.ev);
    const u = ups.find((x) => x.judged)!;
    expect(u.completed).toBe(u.judged);
    expect(u.judged!.outcome).toBe('miss');
  });

  it('ignorePractice = false judges everything', () => {
    const fa = fakeAnalyzer(new Map([[1000, 168]]));
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn, ignorePractice: false });
    feed(s, frames(0, 5000), swingEvents(1000, { practice: true, addressAt: 1800 }).ev);
    expect(s.tally.judged).toBe(1);
  });

  it('not measurable → unknown (not counted as miss)', () => {
    const fa = fakeAnalyzer(new Map([[1000, null]]));
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn });
    const ups = feed(s, frames(0, 5000), swingEvents(1000).ev);
    expect(ups.find((u) => u.judged)!.judged!.outcome).toBe('unknown');
    expect(s.tally).toMatchObject({ judged: 0, unknown: 1 });
  });

  it('outcome rules', () => {
    const c2 = [...armTarget.criteria, { metric: 'shoulder_turn' as const, at: 'top' as const, target: 80, tolerance: 10, unit: 'deg' as const }];
    expect(outcomeOf(evaluateCriteria(c2, (m) => (m === 'lead_arm_angle' ? 120 : null)))).toBe('miss');
    expect(outcomeOf(evaluateCriteria(c2, (m) => (m === 'lead_arm_angle' ? 170 : null)))).toBe('unknown');
  });

  it('shiftSequence moves frame times to video time', () => {
    const seq = { width: 1, height: 1, fps: 30, mirrored: false, frames: frames(1000, 100) };
    expect(shiftSequence(seq, -1000).frames[0].t).toBe(0);
  });
});

// ------------------------------------------------------------------ real SwingTrigger + synthetic range series

function rangeStream(swings: Partial<SynthParams>[], view: 'face_on' | 'down_the_line') {
  const out: PoseFrame[] = [];
  let t0 = 0;
  for (const p of swings) {
    const s = synthSwing({ fps: 30, view, addressMs: 1500, finishHoldMs: 1500, noise: 0.002, ...p });
    for (const f of s.seq.frames) out.push({ ...f, t: t0 + f.t });
    t0 = out[out.length - 1].t + 1000 / 30;
  }
  return out;
}

describe('ball series with the real SwingTrigger (synthetic frames)', () => {
  it('every real swing is judged within 2 s of the trigger impact and completed once', () => {
    const fa = fakeAnalyzer(new Map([[0, 170]]));
    const trig = new SwingTrigger({ shotType: 'iron', view: 'face_on', aspect: 1080 / 1920, preRollMs: 1000 });
    const s = new SeriesSession({ target: armTarget, ctx, width: 1080, height: 1920, analyze: fa.fn, preRollMs: 1000 });
    const fr = rangeStream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], 'face_on');
    const ups = fr.map((f) => s.push(f, trig.push(f)));
    const judged = ups.filter((u) => u.judged).length;
    const completed = ups.filter((u) => u.completed).length;
    const practice = ups.filter((u) => u.practiceIgnored).length;
    // the trigger decides how many swings it sees; every one must end up judged + completed (or ignored as practice)
    expect(judged + practice).toBeGreaterThanOrEqual(2);
    expect(completed).toBe(judged);
    for (const sh of s.results) expect(sh.latencyMs).toBeLessThan(2000);
  });
});

const probe = synthSwing({ view: 'down_the_line' });
const metricsImplemented = (() => {
  try {
    const kf = Object.entries(probe.truth.keyframes).map(([position, frameIndex]) => ({
      position: position as never,
      frameIndex: frameIndex!,
      t: probe.seq.frames[frameIndex!].t,
      confidence: 1,
      method: 'truth',
    }));
    return computeMetrics(probe.seq, probe.truth.club, kf, null, { shotType: 'iron', view: 'down_the_line', handedness: 'right' }).values.length > 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!metricsImplemented)('ball series with real metrics (over the top, DTL)', () => {
  it('good swings hit, over-the-top swings miss', () => {
    const target = targetFromFault(getFaultDef('over_the_top')!, { view: 'down_the_line', withGhost: false })!;
    const dctx: AnalysisContext = { shotType: 'iron', view: 'down_the_line', handedness: 'right' };
    const trig = new SwingTrigger({ shotType: 'iron', view: 'down_the_line', aspect: 1080 / 1920, preRollMs: 1000 });
    const s = new SeriesSession({ target, ctx: dctx, width: 1080, height: 1920, preRollMs: 1000 });
    const fr = rangeStream([{ seed: 1 }, { seed: 2, overTheTop: 0.2 }, { seed: 3 }], 'down_the_line');
    const outcomes = fr.map((f) => s.push(f, trig.push(f))).filter((u) => u.judged).map((u) => u.judged!.outcome);
    expect(outcomes).toEqual(['hit', 'miss', 'hit']);
    expect(s.tally).toMatchObject({ hits: 2, judged: 3 });
  });
});
