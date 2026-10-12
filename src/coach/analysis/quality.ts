import type { AnalysisQuality, ClubEstimate, PhaseKeyframe, PoseSequence } from '../model/types';
import type { AnalysisContext } from './context';

/**
 * OWNER: agent "capture-pose" (work package C / quality rule of brief section 7).
 * Rate how trustworthy the recording is. Below QUALITY_MIN the app shows "not reliably detectable" instead of faults.
 * `extra` is passed on the second call, after phases and club are known.
 */
export function assessQuality(
  seq: PoseSequence,
  _ctx: AnalysisContext,
  _extra?: { keyframes?: PhaseKeyframe[]; club?: (ClubEstimate | null)[] },
): AnalysisQuality {
  const detected = seq.frames.filter((f) => f.lm).length;
  const ratio = seq.frames.length ? detected / seq.frames.length : 0;
  return { score: ratio, detectedFrameRatio: ratio, meanVisibility: 1, fps: seq.fps, issues: [] }; // TODO(capture-pose)
}
