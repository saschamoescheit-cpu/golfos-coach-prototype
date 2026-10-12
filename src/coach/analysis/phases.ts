import type { ClubEstimate, PhaseKeyframe, PoseSequence } from '../model/types';
import type { AnalysisContext } from './context';

/**
 * OWNER: agent "phases-metrics" (work package C).
 * Find the key positions of SHOT_TYPES[ctx.shotType].positions in a smoothed canonical sequence.
 * 9 o'clock = shaft parallel to the ground (use club when confident, otherwise a documented hand-height proxy).
 * Returns them in swing order; positions that cannot be found are omitted.
 */
export function detectKeyframes(_seq: PoseSequence, _club: (ClubEstimate | null)[], _ctx: AnalysisContext): PhaseKeyframe[] {
  return []; // TODO(phases-metrics)
}
