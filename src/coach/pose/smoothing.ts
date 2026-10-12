import type { PoseSequence } from '../model/types';

/**
 * OWNER: agent "capture-pose" (work package B/C).
 * Smooth landmark jitter and fill short gaps (frames without detection) without shifting fast swing events in time.
 * Must keep frames.length and timestamps unchanged.
 */
export function smoothSequence(seq: PoseSequence): PoseSequence {
  return seq; // TODO(capture-pose): implement
}
