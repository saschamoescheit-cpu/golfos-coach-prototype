import { QUALITY_MIN } from '../model/constants';
import type { AnalysisQuality, ClubEstimate, Fault, Line2, PhaseKeyframe, PoseSequence, SwingMetrics, SwingScore } from '../model/types';
import type { GrayImage } from '../club/ClubProvider';
import { mirrorGray } from '../club/image';
import { trackClub } from '../club/track';
import { evaluateFaults } from '../faults/engine';
import { computeSwingScore } from '../faults/score';
import { toCanonical } from '../pose/mirror';
import { smoothSequence } from '../pose/smoothing';
import type { AnalysisContext } from './context';
import { computeMetrics } from './metrics';
import { detectKeyframes } from './phases';
import { assessQuality } from './quality';

export interface AnalysisInput {
  /** poses as detected on the original (unmirrored) video */
  raw: PoseSequence;
  /** optional grayscale frames of the original video (same length as raw.frames) for the club detector */
  images?: (GrayImage | undefined)[];
  ctx: AnalysisContext;
}

export interface AnalysisResult {
  /** smoothed, canonical (right-handed) sequence */
  pose: PoseSequence;
  club: (ClubEstimate | null)[];
  neutralLine: Line2 | null;
  keyframes: PhaseKeyframe[];
  metrics: SwingMetrics;
  quality: AnalysisQuality;
  faults: Fault[];
  checkedFaultIds: string[];
  uncertainFaultIds: string[];
  score: SwingScore | null;
}

/**
 * The whole analysis without camera or DOM: pose sequence (+ optional pixels) in, diagnosis out.
 * Pure function → fully testable in Node with the synthetic generator.
 */
export function analyzeSequence({ raw, images, ctx }: AnalysisInput): AnalysisResult {
  const canonical = toCanonical(raw, ctx.handedness);
  const pose = smoothSequence(canonical);
  const canonImages = images && ctx.handedness === 'left' ? images.map((im) => (im ? mirrorGray(im) : undefined)) : images;

  const { club, neutralLine } = trackClub(pose, canonImages, ctx);
  const keyframes = detectKeyframes(pose, club, ctx);
  const metrics = computeMetrics(pose, club, keyframes, neutralLine, ctx);
  const quality = assessQuality(pose, ctx, { keyframes, club });

  const evaluation =
    quality.score >= QUALITY_MIN
      ? evaluateFaults(metrics, keyframes, quality, ctx)
      : { faults: [], checked: [], uncertain: [] as string[] };
  const score = quality.score >= QUALITY_MIN ? computeSwingScore(metrics, ctx) : null;

  return {
    pose,
    club,
    neutralLine,
    keyframes,
    metrics,
    quality,
    faults: evaluation.faults,
    checkedFaultIds: evaluation.checked,
    uncertainFaultIds: evaluation.uncertain,
    score,
  };
}
