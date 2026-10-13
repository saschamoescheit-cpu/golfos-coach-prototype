import { ALL_SHOT_TYPES } from '../model/constants';
import type { CameraView, KeyPosition, MetricId, ShotType } from '../model/types';

/**
 * Machine-readable copy of docs/coach/02_METRICS.md (binding metrics contract):
 * at which key positions each metric exists per view, and for which shot types.
 * Used by the engine (rules that cannot exist in the current view/shot are skipped instead of "uncertain")
 * and by the catalog schema test. Keep in sync with 02_METRICS.md.
 */
type At = KeyPosition | 'swing';
export interface MetricAvailability {
  face_on: At[];
  down_the_line: At[];
  shots: ShotType[];
}

const ALL = ALL_SHOT_TYPES;
const FULL: ShotType[] = ['driver', 'iron']; // "voll" in 02_METRICS.md
const FULL_PITCH: ShotType[] = ['driver', 'iron', 'pitch'];
const NOT_PUTT: ShotType[] = ['driver', 'iron', 'pitch', 'chip', 'bunker'];

export const METRIC_CONTRACT: Partial<Record<MetricId, MetricAvailability>> = {
  tempo_ratio: { face_on: ['swing'], down_the_line: ['swing'], shots: ALL },
  backswing_ms: { face_on: ['swing'], down_the_line: ['swing'], shots: ALL },
  downswing_ms: { face_on: ['swing'], down_the_line: ['swing'], shots: ALL },
  swing_length: { face_on: ['top'], down_the_line: ['top'], shots: ALL },
  head_shift_x: { face_on: ['top', 'impact'], down_the_line: [], shots: ALL },
  head_shift_y: { face_on: ['top', 'impact'], down_the_line: ['top', 'impact'], shots: ALL },
  hip_shift_x: { face_on: ['top', 'impact', 'finish'], down_the_line: [], shots: ['driver', 'iron', 'pitch', 'chip', 'bunker'] },
  side_bend: { face_on: ['address', 'top', 'impact'], down_the_line: [], shots: FULL },
  shoulder_turn: { face_on: ['top'], down_the_line: ['top'], shots: FULL_PITCH },
  hip_turn: { face_on: ['top', 'impact'], down_the_line: ['top', 'impact'], shots: FULL },
  x_factor: { face_on: ['top'], down_the_line: ['top'], shots: FULL },
  lead_arm_angle: { face_on: ['top', 'impact'], down_the_line: ['top'], shots: FULL_PITCH },
  lead_arm_post_impact: { face_on: ['swing'], down_the_line: [], shots: FULL_PITCH },
  trail_arm_angle: { face_on: [], down_the_line: ['top'], shots: FULL },
  lead_wrist_hinge: { face_on: ['top', 'downswing9'], down_the_line: ['top', 'downswing9'], shots: FULL_PITCH },
  hands_ahead: { face_on: ['impact'], down_the_line: [], shots: NOT_PUTT },
  shaft_lean: { face_on: ['impact'], down_the_line: [], shots: ALL },
  stance_width: { face_on: ['address'], down_the_line: [], shots: ALL },
  spine_angle: { face_on: [], down_the_line: ['address', 'top', 'impact'], shots: ALL },
  spine_angle_change: { face_on: [], down_the_line: ['top', 'impact'], shots: FULL_PITCH },
  hip_depth_change: { face_on: [], down_the_line: ['top', 'impact'], shots: FULL_PITCH },
  knee_flex: { face_on: [], down_the_line: ['address'], shots: ALL },
  hand_depth: { face_on: [], down_the_line: ['backswing9', 'top', 'downswing9'], shots: FULL },
  hand_path_shift: { face_on: [], down_the_line: ['downswing9'], shots: FULL },
  shaft_plane_dev: { face_on: [], down_the_line: ['backswing9', 'top', 'downswing9'], shots: FULL_PITCH },
  body_motion: { face_on: ['swing'], down_the_line: ['swing'], shots: ['putt', 'chip'] },
  putter_wrist_change: { face_on: ['swing'], down_the_line: ['swing'], shots: ['putt'] },
};

/** Is this metric computed at this position in this view for this shot type (per 02_METRICS.md)? */
export function metricAvailable(metric: MetricId, at: At, view: CameraView, shot: ShotType): boolean {
  const a = METRIC_CONTRACT[metric];
  if (!a) return false;
  return a[view].includes(at) && a.shots.includes(shot);
}
