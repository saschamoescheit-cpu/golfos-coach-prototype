import { LM } from '../model/constants';
import type { MetricId, MetricUnit } from '../model/types';

/**
 * Static facts about metrics that the training mode needs: unit (from docs/coach/02_METRICS.md), which skeleton lines
 * belong to a metric (they get coloured by that criterion's proximity) and a default tolerance for targets built from a
 * reference swing.
 */
// Partial on purpose: other agents may add MetricIds (additively) – unknown ones fall back to unitOf() below.
export const METRIC_UNITS: Partial<Record<MetricId, MetricUnit>> = {
  shoulder_turn: 'deg',
  hip_turn: 'deg',
  x_factor: 'deg',
  spine_angle: 'deg',
  spine_angle_change: 'deg',
  side_bend: 'deg',
  head_shift_x: 'pct_torso',
  head_shift_y: 'pct_torso',
  hip_shift_x: 'pct_torso',
  hip_depth_change: 'pct_torso',
  lead_arm_angle: 'deg',
  trail_arm_angle: 'deg',
  lead_wrist_hinge: 'deg',
  hand_height: 'pct_torso',
  hand_depth: 'pct_torso',
  hands_ahead: 'pct_torso',
  shaft_plane_dev: 'deg',
  shaft_lean: 'deg',
  knee_flex: 'deg',
  stance_width: 'ratio',
  tempo_ratio: 'ratio',
  backswing_ms: 'ms',
  downswing_ms: 'ms',
  putter_wrist_change: 'deg',
  body_motion: 'pct_torso',
  swing_length: 'deg',
  lead_arm_post_impact: 'deg',
  hand_path_shift: 'pct_torso',
};

const L = LM;
/** Skeleton lines (pairs as in SKELETON, first index = pivot of the tolerance fan) that show a metric. */
export const METRIC_SEGMENTS: Partial<Record<MetricId, [number, number][]>> = {
  shoulder_turn: [[L.LEFT_SHOULDER, L.RIGHT_SHOULDER]],
  hip_turn: [[L.LEFT_HIP, L.RIGHT_HIP]],
  x_factor: [[L.LEFT_SHOULDER, L.RIGHT_SHOULDER], [L.LEFT_HIP, L.RIGHT_HIP]],
  spine_angle: [[L.LEFT_HIP, L.LEFT_SHOULDER], [L.RIGHT_HIP, L.RIGHT_SHOULDER]],
  spine_angle_change: [[L.LEFT_HIP, L.LEFT_SHOULDER], [L.RIGHT_HIP, L.RIGHT_SHOULDER]],
  side_bend: [[L.LEFT_HIP, L.LEFT_SHOULDER], [L.RIGHT_HIP, L.RIGHT_SHOULDER]],
  head_shift_x: [[L.LEFT_SHOULDER, L.RIGHT_SHOULDER]],
  head_shift_y: [[L.LEFT_SHOULDER, L.RIGHT_SHOULDER]],
  hip_shift_x: [[L.LEFT_HIP, L.RIGHT_HIP]],
  hip_depth_change: [[L.LEFT_HIP, L.RIGHT_HIP], [L.LEFT_KNEE, L.LEFT_HIP], [L.RIGHT_KNEE, L.RIGHT_HIP]],
  lead_arm_angle: [[L.LEFT_SHOULDER, L.LEFT_ELBOW], [L.LEFT_ELBOW, L.LEFT_WRIST]],
  lead_arm_post_impact: [[L.LEFT_SHOULDER, L.LEFT_ELBOW], [L.LEFT_ELBOW, L.LEFT_WRIST]],
  trail_arm_angle: [[L.RIGHT_SHOULDER, L.RIGHT_ELBOW], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  lead_wrist_hinge: [[L.LEFT_ELBOW, L.LEFT_WRIST]],
  hand_height: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  hand_depth: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  hand_path_shift: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  hands_ahead: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  shaft_plane_dev: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
  shaft_lean: [[L.LEFT_ELBOW, L.LEFT_WRIST]],
  knee_flex: [[L.RIGHT_HIP, L.RIGHT_KNEE], [L.RIGHT_KNEE, L.RIGHT_ANKLE]],
  stance_width: [[L.LEFT_KNEE, L.LEFT_ANKLE], [L.RIGHT_KNEE, L.RIGHT_ANKLE]],
  swing_length: [[L.LEFT_SHOULDER, L.LEFT_ELBOW], [L.LEFT_ELBOW, L.LEFT_WRIST]],
  body_motion: [[L.LEFT_SHOULDER, L.RIGHT_SHOULDER]],
  putter_wrist_change: [[L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_ELBOW, L.RIGHT_WRIST]],
};

/**
 * Default tolerance per metric for targets made from the player's own reference swing ("hit this position again").
 * REVIEW(golf): assumptions – roughly what a teacher would still call "the same position"; to be tuned with Chris.
 */
export const DEFAULT_TOLERANCE: Partial<Record<MetricId, number>> = {
  shoulder_turn: 12, // REVIEW(golf)
  hip_turn: 10, // REVIEW(golf)
  spine_angle: 5, // REVIEW(golf)
  spine_angle_change: 5, // REVIEW(golf)
  side_bend: 6, // REVIEW(golf)
  head_shift_x: 6, // REVIEW(golf) pct_torso ≈ 3 cm at 50 cm torso
  head_shift_y: 6, // REVIEW(golf)
  hip_shift_x: 8, // REVIEW(golf)
  hip_depth_change: 6, // REVIEW(golf)
  lead_arm_angle: 10, // REVIEW(golf)
  trail_arm_angle: 12, // REVIEW(golf)
  lead_wrist_hinge: 12, // REVIEW(golf)
  hand_depth: 8, // REVIEW(golf)
  hands_ahead: 8, // REVIEW(golf)
  shaft_plane_dev: 6, // REVIEW(golf)
  shaft_lean: 6, // REVIEW(golf)
  knee_flex: 8, // REVIEW(golf)
  stance_width: 0.15, // REVIEW(golf)
  tempo_ratio: 0.3, // REVIEW(golf) – same as SHOT_TYPES tempo tolerance
  swing_length: 12, // REVIEW(golf)
  body_motion: 4, // REVIEW(golf)
  putter_wrist_change: 4, // REVIEW(golf)
  lead_arm_post_impact: 12, // REVIEW(golf)
  hand_path_shift: 6, // REVIEW(golf)
};

/**
 * Metrics worth training at one position, best first. Display-only values (x_factor, ms, hand_height) are left out.
 * A reference target takes at most MAX_REFERENCE_CRITERIA of these (one clear thing to work on beats ten numbers).
 */
export const TRAINABLE_METRICS: MetricId[] = [
  'shaft_plane_dev',
  'lead_arm_angle',
  'spine_angle_change',
  'hip_depth_change',
  'shoulder_turn',
  'side_bend',
  'head_shift_x',
  'hip_shift_x',
  'lead_wrist_hinge',
  'hands_ahead',
  'shaft_lean',
  'spine_angle',
  'knee_flex',
  'hip_turn',
  'trail_arm_angle',
  'head_shift_y',
  'hand_depth',
  'stance_width',
  'swing_length',
];
export const MAX_REFERENCE_CRITERIA = 3;

export function unitOf(metric: MetricId): MetricUnit {
  return METRIC_UNITS[metric] ?? 'deg';
}

/** Short unit suffix for display. */
export function unitSuffix(unit: MetricUnit): string {
  switch (unit) {
    case 'deg':
      return '°';
    case 'pct_torso':
      return '%';
    case 'ms':
      return ' ms';
    default:
      return '';
  }
}
