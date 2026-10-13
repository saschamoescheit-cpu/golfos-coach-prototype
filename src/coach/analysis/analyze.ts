import type { AnalysisQuality, ClubEstimate, Fault, Line2, PhaseKeyframe, PoseSequence, ScoreLevel, Swing, SwingMetrics, SwingScore } from '../model/types';
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
  /** player level for the swing score (1 = strict … 5 = beginner); default from score.json (level 3) */
  scoreLevel?: ScoreLevel;
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

/** Turn an analysis result into a storable Swing. */
export function buildSwing(
  r: AnalysisResult,
  meta: { id: string; sessionId: string; ctx: AnalysisContext; source: Swing['source']; createdAt?: number },
): Swing {
  const frames = r.pose.frames;
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    createdAt: meta.createdAt ?? Date.now(),
    shotType: meta.ctx.shotType,
    view: meta.ctx.view,
    handedness: meta.ctx.handedness,
    source: meta.source,
    durationMs: frames.length ? frames[frames.length - 1].t - frames[0].t : 0,
    pose: r.pose,
    club: r.club,
    neutralLine: r.neutralLine,
    keyframes: r.keyframes,
    metrics: r.metrics,
    quality: r.quality,
    faults: r.faults,
    checkedFaultIds: r.checkedFaultIds,
    uncertainFaultIds: r.uncertainFaultIds,
    score: r.score,
  };
}

/**
 * The whole analysis without camera or DOM: pose sequence (+ optional pixels) in, diagnosis out.
 * Pure function → fully testable in Node with the synthetic generator.
 */
export function analyzeSequence({ raw, images, ctx, scoreLevel }: AnalysisInput): AnalysisResult {
  const canonical = toCanonical(raw, ctx.handedness);
  const pose = smoothSequence(canonical);
  const canonImages = images && ctx.handedness === 'left' ? images.map((im) => (im ? mirrorGray(im) : undefined)) : images;

  const { club, neutralLine } = trackClub(pose, canonImages, ctx);
  const keyframes = detectKeyframes(pose, club, ctx);
  const metrics = computeMetrics(pose, club, keyframes, neutralLine, ctx);
  const quality = assessQuality(pose, ctx, { keyframes, club });

  // the engine handles low quality itself (everything 'uncertain' → shown as "not reliably detectable")
  const evaluation = evaluateFaults(metrics, keyframes, quality, ctx);
  const score = computeSwingScore(metrics, ctx, { fps: pose.fps, level: scoreLevel, quality: quality.score });

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
