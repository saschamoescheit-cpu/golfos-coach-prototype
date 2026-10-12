import type { CameraView, ClubEstimate, Landmark, ShotType } from '../model/types';

/**
 * Club (shaft) detection behind an interface (brief section 2). MediaPipe does not see the club.
 * V1 (decision 12.10.2026): find the shaft as a straight line in the image next to the hands, with an estimate from
 * wrists/forearms as fallback (source 'hands', lower confidence). A trained club detector can replace this later
 * without touching the analysis code.
 */

/** Grayscale picture of one frame, downscaled (e.g. longest side 360 px). Plain data so it works in Node tests. */
export interface GrayImage {
  width: number;
  height: number;
  /** one byte per pixel, row-major */
  data: Uint8ClampedArray;
}

export interface ClubFrameInput {
  /** canonical (right-handed) landmarks of this frame; null when no person */
  lm: Landmark[] | null;
  /**
   * Grayscale image of the frame in the SAME canonical orientation as lm (mirrored for left-handers),
   * or undefined when no pixels are available (e.g. live mode) → providers fall back to the hand estimate.
   */
  image?: GrayImage;
  /** aspect ratio width/height of the source video */
  aspect: number;
  /** club of the previous frame (tracking prior) */
  prev?: ClubEstimate | null;
  view: CameraView;
  shotType: ShotType;
}

export interface ClubProvider {
  readonly id: string;
  estimate(input: ClubFrameInput): ClubEstimate | null;
}
