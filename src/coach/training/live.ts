import type { AnalysisContext } from '../analysis/context';
import { metricsAtFrame } from '../analysis/metrics';
import { trackClub } from '../club/track';
import { LM } from '../model/constants';
import { dist, mid, pt } from '../model/geometry';
import type { Landmark, MetricValue, PoseFrame, PoseSequence, TargetCriterion, TrainingTarget } from '../model/types';
import { evaluateCriteria, type Evaluation } from './proximity';

/**
 * Live evaluation for the mirror mode: one CANONICAL live frame against the player's address frame.
 * Uses metricsAtFrame (agent phases-metrics) so that live numbers and swing analysis share one definition.
 * The club comes from trackClub without images → hand estimate (confidence ≤ 0.4). Club criteria
 * (shaft_plane_dev, lead_wrist_hinge, shaft_lean) are therefore only rough in the mirror mode.
 */
export interface LiveDims {
  width: number;
  height: number;
  fps: number;
}

/** Criteria the mirror mode can judge: the ones at the trained position (whole-swing values like tempo need a swing). */
export function mirrorCriteria(target: TrainingTarget): TargetCriterion[] {
  return target.criteria.filter((c) => c.at === target.position);
}

export function liveMetricValues(
  target: TrainingTarget,
  addressFrame: PoseFrame | null,
  frame: PoseFrame,
  dims: LiveDims,
  ctx: AnalysisContext,
): MetricValue[] {
  if (!frame.lm) return [];
  const frames = target.position === 'address' || !addressFrame ? [frame] : [addressFrame, frame];
  const seq: PoseSequence = { width: dims.width, height: dims.height, fps: dims.fps, frames, mirrored: ctx.handedness === 'left' };
  const fi = frames.length - 1;
  try {
    const { club, neutralLine } = trackClub(seq, undefined, ctx);
    return metricsAtFrame(seq, fi, 0, target.position, club, neutralLine, ctx);
  } catch {
    return [];
  }
}

export function evaluateLiveFrame(
  target: TrainingTarget,
  addressFrame: PoseFrame | null,
  frame: PoseFrame,
  dims: LiveDims,
  ctx: AnalysisContext,
  toleranceScale: number,
): Evaluation {
  return evaluateCriteria(mirrorCriteria(target), liveMetricValues(target, addressFrame, frame, dims, ctx), toleranceScale);
}

let available: boolean | null = null;
/**
 * Does metricsAtFrame deliver values at all? (false while the phases-metrics package is still a stub – the UI then
 * explains why everything stays grey instead of pretending the player is out of position.) Probed once on a
 * synthetic face-on top position.
 */
export function liveMetricsAvailable(probe: () => { seq: PoseSequence; top: number; address: number }): boolean {
  if (available != null) return available;
  try {
    const { seq, top, address } = probe();
    const ctx: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
    const { club, neutralLine } = trackClub(seq, undefined, ctx);
    available = metricsAtFrame(seq, top, address, 'top', club, neutralLine, ctx).length > 0;
  } catch {
    available = false;
  }
  return available;
}

// ------------------------------------------------------------------ address capture (mirror mode reference)

/**
 * Detects "the player stands still in an address-like posture" so the mirror mode can take its reference frame
 * (needed for all "change vs. address" metrics) without a button press. Pure; feed canonical frames.
 * Address-like = both wrists below the hip line (hands hang in front of the thighs). Still = shoulders, hips and
 * wrists moved less than maxMotionPct of the torso length during the last windowMs.
 */
export interface StillnessOptions {
  windowMs: number;
  maxMotionPct: number;
}
export const STILLNESS_DEFAULTS: StillnessOptions = { windowMs: 900, maxMotionPct: 5 };

const STILL_POINTS = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_WRIST, LM.RIGHT_WRIST];

export function torsoLength(lm: Landmark[], aspect: number): number | null {
  const ls = pt(lm, LM.LEFT_SHOULDER, aspect);
  const rs = pt(lm, LM.RIGHT_SHOULDER, aspect);
  const lh = pt(lm, LM.LEFT_HIP, aspect);
  const rh = pt(lm, LM.RIGHT_HIP, aspect);
  if (!ls || !rs || !lh || !rh) return null;
  const l = dist(mid(ls, rs), mid(lh, rh));
  return l > 0 ? l : null;
}

export function isAddressLike(lm: Landmark[]): boolean {
  const hipY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
  const shY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
  const torso = hipY - shY;
  if (!(torso > 0)) return false;
  // hands at least a little below the hip line (REVIEW(golf): putting grips sit higher – 0 keeps them in)
  return lm[LM.LEFT_WRIST].y > hipY - 0.05 * torso && lm[LM.RIGHT_WRIST].y > hipY - 0.05 * torso;
}

export class StillnessDetector {
  readonly opts: StillnessOptions;
  private buf: PoseFrame[] = [];
  constructor(private readonly aspect: number, opts: Partial<StillnessOptions> = {}) {
    this.opts = { ...STILLNESS_DEFAULTS, ...opts };
  }

  /** returns true when the player has been still (and address-like) for the whole window */
  push(f: PoseFrame): boolean {
    if (!f.lm) {
      this.buf = [];
      return false;
    }
    this.buf.push(f);
    while (this.buf.length > 2 && f.t - this.buf[1].t >= this.opts.windowMs) this.buf.shift();
    if (f.t - this.buf[0].t < this.opts.windowMs) return false;
    if (!isAddressLike(f.lm)) return false;
    const torso = torsoLength(f.lm, this.aspect);
    if (!torso) return false;
    for (const i of STILL_POINTS) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const b of this.buf) {
        const p = b.lm![i];
        x0 = Math.min(x0, p.x * this.aspect);
        x1 = Math.max(x1, p.x * this.aspect);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      if (Math.hypot(x1 - x0, y1 - y0) / torso > this.opts.maxMotionPct / 100) return false;
    }
    return true;
  }

  reset(): void {
    this.buf = [];
  }
}
