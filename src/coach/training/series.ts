import { analyzeSequence, type AnalysisInput, type AnalysisResult } from '../analysis/analyze';
import type { AnalysisContext } from '../analysis/context';
import { getMetric, metricsAtFrame } from '../analysis/metrics';
import type { TriggerEvent } from '../live/swingTrigger';
import type { KeyPosition, MetricId, PoseFrame, PoseSequence, TrainingTarget } from '../model/types';
import { evaluateCriteria, MIN_CONFIDENCE, type Evaluation } from './proximity';

/**
 * Ball series (US-1.10) – pure core, no DOM, no audio. The screen feeds every CANONICAL live frame together with the
 * events the SwingTrigger produced for it; the core answers "judge now" (→ hit/miss tone) and "swing complete"
 * (→ save video + swing).
 *
 * Timing (≤ 2 s from impact to tone): the trigger fires 'impact' about one frame after the real impact. We then wait
 * evalDelayMs of further frames (so phase detection sees the ball being passed and the start of the follow-through),
 * run analyzeSequence on [startT, impactT + evalDelayMs] (poses only, no video decoding; club = hand estimate) and
 * judge only the trained criteria. Typical latency = evalDelayMs + compute (a few ms) ≈ 0.5 s.
 * The 'swing' event (after finish + post-roll) brings the final practice flag; the stored swing is re-analysed on the
 * full window [startT, endT] so the history shows the complete motion.
 *
 * Practice swings: the trigger's rule is "address still < 1 s or small amplitude". Until 'swing' arrives we use a
 * provisional guess with the same address rule (time since the trigger's 'address' event). Disagreements are resolved
 * at 'swing': a swing judged as real but flagged practice is retracted (removed from the tally, no video); a swing
 * skipped as practice but confirmed real is judged late.
 */
export type SeriesOutcome = 'hit' | 'miss' | 'unknown';

export interface SeriesShot {
  /** running number of the swing in this series (1-based, practice swings not counted) */
  n: number;
  outcome: SeriesOutcome;
  hit: boolean;
  proximity: number | null;
  evaluation: Evaluation;
  startT: number;
  topT: number | null;
  impactT: number;
  endT: number | null;
  /** ms from impact until the result was available (frame clock + compute time) */
  latencyMs: number;
  /** analysis used for the judgement (window up to shortly after impact) */
  judged: AnalysisResult;
  /** analysis of the full swing window – set when the 'swing' event arrived */
  full: AnalysisResult | null;
  practice: boolean;
}

export interface SeriesTally {
  hits: number;
  /** swings with a clear hit/miss */
  judged: number;
  /** swings that could not be judged ("not reliably detectable") */
  unknown: number;
  /** practice swings that were ignored */
  practice: number;
}

export interface SeriesUpdate {
  /** a swing was just judged → play the hit/miss tone now */
  judged?: SeriesShot;
  /** the swing is complete (finish + post-roll) → stop the recorder, save video + swing */
  completed?: SeriesShot;
  /** a judged swing turned out to be a practice swing → not counted, no video */
  retracted?: SeriesShot;
  /** a practice swing was ignored (no tone, nothing saved) */
  practiceIgnored?: boolean;
}

export interface SeriesOptions {
  target: TrainingTarget;
  ctx: AnalysisContext;
  /** camera picture size in pixels (for aspect-correct metrics) */
  width: number;
  height: number;
  /** settings.toleranceScale */
  toleranceScale?: number;
  /** frames to wait after the impact event before judging (ms) */
  evalDelayMs?: number;
  /** ring buffer length of live frames (ms) */
  bufferMs?: number;
  /** must match the trigger options (provisional practice guess) */
  preRollMs?: number;
  stillMs?: number;
  practiceAddressMs?: number;
  /** false = judge every swing, also those that look like practice swings */
  ignorePractice?: boolean;
  /** injectable for tests */
  analyze?: (input: AnalysisInput) => AnalysisResult;
  clock?: () => number;
}

export const SERIES_DEFAULTS = {
  evalDelayMs: 400,
  bufferMs: 12000,
  preRollMs: 1000,
  stillMs: 500,
  practiceAddressMs: 1000,
};

interface Pending {
  startT: number;
  topT: number | null;
  impactT: number;
  practiceGuess: boolean;
  shot: SeriesShot | null;
  skipped: boolean;
}

export class SeriesSession {
  private readonly o: Required<Omit<SeriesOptions, 'analyze' | 'clock'>> & Pick<SeriesOptions, 'analyze' | 'clock'>;
  private buf: PoseFrame[] = [];
  private lastAddressT: number | null = null;
  private pending: Pending | null = null;
  private readonly shots: SeriesShot[] = [];
  private practiceCount = 0;
  private counter = 0;

  constructor(opts: SeriesOptions) {
    this.o = {
      toleranceScale: 1,
      ignorePractice: true,
      ...SERIES_DEFAULTS,
      ...opts,
    } as SeriesSession['o'];
  }

  get target(): TrainingTarget {
    return this.o.target;
  }

  /** all counted swings so far (practice swings and retracted ones excluded) */
  get results(): SeriesShot[] {
    return [...this.shots];
  }

  get tally(): SeriesTally {
    const judged = this.shots.filter((s) => s.outcome !== 'unknown');
    return {
      hits: judged.filter((s) => s.hit).length,
      judged: judged.length,
      unknown: this.shots.length - judged.length,
      practice: this.practiceCount,
    };
  }

  /** Feed one canonical live frame plus the trigger events it produced (trigger.push(frame)). */
  push(frame: PoseFrame, events: TriggerEvent[] = []): SeriesUpdate {
    this.buf.push(frame);
    const cut = frame.t - this.o.bufferMs;
    while (this.buf.length && this.buf[0].t < cut) this.buf.shift();
    const up: SeriesUpdate = {};

    for (const e of events) {
      if (e.type === 'address') this.lastAddressT = frame.t;
      else if (e.type === 'lost') this.pending = null;
      else if (e.type === 'impact') {
        this.pending = {
          startT: e.startT,
          topT: e.topT,
          impactT: e.impactT,
          practiceGuess: this.guessPractice(e),
          shot: null,
          skipped: false,
        };
      } else if (e.type === 'swing') {
        Object.assign(up, this.onSwing(e, frame.t));
      }
    }

    const p = this.pending;
    if (p && !p.shot && !p.skipped && frame.t >= p.impactT + this.o.evalDelayMs) {
      if (p.practiceGuess && this.o.ignorePractice) p.skipped = true;
      else {
        p.shot = this.judge(p.startT, p.topT, p.impactT, p.impactT + this.o.evalDelayMs, frame.t);
        up.judged = p.shot;
      }
    }
    return up;
  }

  private guessPractice(e: Extract<TriggerEvent, { type: 'impact' }>): boolean {
    // forward compatible: a trigger that already knows it may put `practice` on the impact event
    const flagged = (e as { practice?: boolean }).practice;
    if (typeof flagged === 'boolean') return flagged;
    if (this.lastAddressT == null) return true;
    const takeaway = e.startT + this.o.preRollMs;
    const stillMs = takeaway - this.lastAddressT + this.o.stillMs;
    return stillMs < this.o.practiceAddressMs;
  }

  private onSwing(e: Extract<TriggerEvent, { type: 'swing' }>, now: number): SeriesUpdate {
    const up: SeriesUpdate = {};
    let p = this.pending;
    this.pending = null;
    if (!p || (e.impactT != null && Math.abs(p.impactT - e.impactT) > 50)) {
      // no impact event seen (older trigger / missed) → judge from the swing window
      if (e.impactT == null) {
        if (e.practice && this.o.ignorePractice) {
          this.practiceCount++;
          up.practiceIgnored = true;
        }
        return up;
      }
      p = { startT: e.startT, topT: e.topT, impactT: e.impactT, practiceGuess: e.practice, shot: null, skipped: false };
    }
    const practice = e.practice && this.o.ignorePractice;
    if (practice) {
      this.practiceCount++;
      if (p.shot) {
        const i = this.shots.indexOf(p.shot);
        if (i >= 0) this.shots.splice(i, 1);
        this.counter--;
        p.shot.practice = true;
        up.retracted = p.shot;
      } else up.practiceIgnored = true;
      return up;
    }
    if (!p.shot) {
      p.shot = this.judge(p.startT, p.topT, p.impactT, p.impactT + this.o.evalDelayMs, now);
      up.judged = p.shot;
    }
    p.shot.endT = e.endT;
    p.shot.full = this.run(this.window(e.startT, e.endT)) ?? p.shot.judged;
    up.completed = p.shot;
    return up;
  }

  private window(from: number, to: number): PoseSequence {
    const frames = this.buf.filter((f) => f.t >= from && f.t <= to);
    const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    const fps = span > 0 ? ((frames.length - 1) * 1000) / span : 30;
    return {
      width: this.o.width,
      height: this.o.height,
      fps,
      frames,
      // frames are canonical already → analyzeSequence must not mirror again
      mirrored: this.o.ctx.handedness === 'left',
    };
  }

  private run(seq: PoseSequence): AnalysisResult | null {
    if (seq.frames.length < 3) return null;
    try {
      return (this.o.analyze ?? analyzeSequence)({ raw: seq, ctx: this.o.ctx });
    } catch {
      return null;
    }
  }

  private judge(startT: number, topT: number | null, impactT: number, untilT: number, frameT: number): SeriesShot {
    const clock = this.o.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const t0 = clock();
    const seq = this.window(startT, untilT);
    const result = this.run(seq) ?? emptyResult(seq);
    const evaluation = evaluateSeriesCriteria(this.o.target, result, this.o.ctx, this.o.toleranceScale);
    const outcome = outcomeOf(evaluation);
    const shot: SeriesShot = {
      n: ++this.counter,
      outcome,
      hit: outcome === 'hit',
      proximity: evaluation.proximity,
      evaluation,
      startT,
      topT,
      impactT,
      endT: null,
      latencyMs: frameT - impactT + (clock() - t0),
      judged: result,
      full: null,
      practice: false,
    };
    this.shots.push(shot);
    return shot;
  }
}

/** hit = all criteria inside; miss = at least one measured criterion outside; unknown = otherwise. */
export function outcomeOf(ev: Evaluation): SeriesOutcome {
  if (ev.hit) return 'hit';
  if (ev.criteria.some((c) => c.distance != null && !c.within)) return 'miss';
  return 'unknown';
}

/**
 * Judge the target's criteria on an analysed swing: value from computeMetrics at the criterion's position; when
 * computeMetrics does not provide it but the key frame exists, metricsAtFrame (same definitions) fills the gap.
 */
export function evaluateSeriesCriteria(target: TrainingTarget, r: AnalysisResult, ctx: AnalysisContext, toleranceScale = 1): Evaluation {
  const addr = r.keyframes.find((k) => k.position === 'address')?.frameIndex ?? 0;
  const frameCache = new Map<KeyPosition, ReturnType<typeof metricsAtFrame>>();
  const lookup = (metric: MetricId, at: KeyPosition | 'swing'): number | null => {
    const m = getMetric(r.metrics, metric, at);
    if (m && Number.isFinite(m.value) && m.confidence >= MIN_CONFIDENCE) return m.value;
    if (at === 'swing') return null;
    const kf = r.keyframes.find((k) => k.position === at);
    if (!kf) return null;
    if (!frameCache.has(at)) {
      let vals: ReturnType<typeof metricsAtFrame> = [];
      try {
        vals = metricsAtFrame(r.pose, kf.frameIndex, addr, at, r.club, r.neutralLine, ctx);
      } catch {
        vals = [];
      }
      frameCache.set(at, vals);
    }
    const v = frameCache.get(at)!.find((x) => x.id === metric);
    return v && Number.isFinite(v.value) && v.confidence >= MIN_CONFIDENCE ? v.value : null;
  };
  return evaluateCriteria(target.criteria, lookup, toleranceScale);
}

function emptyResult(seq: PoseSequence): AnalysisResult {
  return {
    pose: seq,
    club: seq.frames.map(() => null),
    neutralLine: null,
    keyframes: [],
    metrics: { values: [] },
    quality: { score: 0, detectedFrameRatio: 0, meanVisibility: 0, fps: seq.fps, issues: ['too_short'] },
    faults: [],
    checkedFaultIds: [],
    uncertainFaultIds: [],
    score: null,
  };
}

/** Shift all frame times (e.g. loop clock → video time of the recorded clip). Keeps everything else. */
export function shiftSequence(seq: PoseSequence, dtMs: number): PoseSequence {
  return { ...seq, frames: seq.frames.map((f) => ({ ...f, t: f.t + dtMs })) };
}

/** "7 of 10" share 0..1, null without judged swings. */
export function hitRate(t: SeriesTally): number | null {
  return t.judged ? t.hits / t.judged : null;
}
