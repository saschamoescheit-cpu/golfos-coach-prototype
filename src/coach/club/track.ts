import type { ClubEstimate, Line2, PoseSequence } from '../model/types';
import type { AnalysisContext } from '../analysis/context';
import type { GrayImage } from './ClubProvider';

export interface ClubTrack {
  /** one entry per frame of seq (null = unknown) */
  club: (ClubEstimate | null)[];
  /** neutral line = address shaft extended (only meaningful down-the-line; computed for both views) */
  neutralLine: Line2 | null;
}

/**
 * OWNER: agent "club" (work package C, ClubProvider).
 * Track the shaft through the swing. `images` are canonical-orientation grayscale frames (same length as seq.frames,
 * entries may be undefined). Without images the hand-estimate provider is used for every frame.
 */
export function trackClub(seq: PoseSequence, _images: (GrayImage | undefined)[] | undefined, _ctx: AnalysisContext): ClubTrack {
  return { club: seq.frames.map(() => null), neutralLine: null }; // TODO(club)
}
