import type { PoseFrame, ShotType, CameraView } from '../model/types';

/**
 * OWNER: agent "capture-pose" (US-1.0 automatic recording without a button).
 * Pure state machine fed with CANONICAL live pose frames (~15–30 per second). Used by the capture screen
 * (auto-record) and by the training series (agent "training").
 *
 * Events:
 * - 'player'  : a person is fully in the frame ("Player detected")
 * - 'address' : the player stands still in an address posture ("Ready for swing")
 * - 'swing'   : a complete swing happened; startT/endT bracket it (ms, same clock as the frames) incl. pre/post-roll
 *               practice = true when it looks like a practice swing (best effort, see DECISIONS)
 * - 'lost'    : the player left the frame
 */
export type TriggerEvent =
  | { type: 'player' }
  | { type: 'address' }
  | { type: 'swing'; startT: number; topT: number | null; impactT: number | null; endT: number; practice: boolean }
  | { type: 'lost' };

export interface SwingTriggerOptions {
  shotType: ShotType;
  view: CameraView;
  /** pre-roll before the takeaway and post-roll after the finish to keep in the clip (ms) */
  preRollMs?: number;
  postRollMs?: number;
}

export class SwingTrigger {
  constructor(readonly opts: SwingTriggerOptions) {}
  /** feed one frame; returns the events it caused (usually none) */
  push(_frame: PoseFrame): TriggerEvent[] {
    return []; // TODO(capture-pose)
  }
  reset(): void {}
}
