/**
 * Coach module – data model (work package A).
 *
 * Coordinate convention used everywhere in analysis code ("canonical frame"):
 * - Landmarks are MediaPipe-style normalized image coordinates: x 0..1 left→right, y 0..1 top→bottom.
 * - All analysis runs as if the player were RIGHT-handed. Left-handed swings are mirrored on the way in
 *   (x → 1 − x and left/right landmarks swapped, see pose/mirror.ts), so lead side = left landmarks always.
 * - Face-on (camera in front of the player): the target is to the image RIGHT (+x), the backswing moves the hands to the left.
 * - Down-the-line (camera behind the player, looking at the target): the player stands left in the image and faces image RIGHT
 *   (+x = towards the ball / away from the player's toes).
 * Distances are compared in "pixel space" (x scaled by aspect ratio, see geometry.ts) and expressed relative to body size
 * (torso length) so that zoom and camera distance do not matter.
 */

export type ShotType = 'driver' | 'iron' | 'pitch' | 'chip' | 'bunker' | 'putt';
export type CameraView = 'face_on' | 'down_the_line';
export type Handedness = 'right' | 'left';
export type Lang = 'en' | 'de';

/** Key positions a golf teacher stops the video at (Chris, 06.10.2026). "9 o'clock" = shaft parallel to the ground. */
export type KeyPosition = 'address' | 'backswing9' | 'top' | 'downswing9' | 'impact' | 'finish';

/** Phases = intervals between key positions (glossary of the brief). */
export type SwingPhase = 'address' | 'backswing' | 'top' | 'downswing' | 'impact' | 'follow_through';

// ---------------------------------------------------------------- pose

/** One body point. x, y normalized image coordinates; z relative depth (MediaPipe scale); v visibility 0..1. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  v: number;
}

/** Pose of one video frame. lm has 33 entries (MediaPipe BlazePose order) or is null when nobody was detected. */
export interface PoseFrame {
  /** timestamp in ms from the start of the clip */
  t: number;
  lm: Landmark[] | null;
  /** MediaPipe world landmarks (metres, origin between the hips, x right, y down, z depth); optional */
  world?: Landmark[] | null;
}

export interface PoseSequence {
  /** source video size in pixels (needed for aspect-correct angles) */
  width: number;
  height: number;
  /** effective frames per second of the analysed sequence */
  fps: number;
  frames: PoseFrame[];
  /** true when the sequence was mirrored to the canonical right-handed frame */
  mirrored: boolean;
}

// ---------------------------------------------------------------- club

export interface Vec2 {
  x: number;
  y: number;
}

/** Club (shaft) in one frame, normalized image coordinates in the canonical frame. */
export interface ClubEstimate {
  grip: Vec2;
  head: Vec2;
  /** shaft angle in degrees in pixel space, 0 = pointing image-right, 90 = pointing image-down (y grows downward) */
  angleDeg: number;
  /** image = found as a line in the picture, hands = estimated from wrists/forearms, manual = set by the player */
  source: 'image' | 'hands' | 'manual';
  confidence: number;
}

/** A straight line in normalized coordinates, e.g. the neutral shaft line from address. */
export interface Line2 {
  a: Vec2;
  b: Vec2;
}

// ---------------------------------------------------------------- analysis results

export interface PhaseKeyframe {
  position: KeyPosition;
  frameIndex: number;
  t: number;
  confidence: number;
  /** how the frame was found, for debugging and the report (e.g. 'club-parallel', 'hands-height-proxy') */
  method: string;
}

/**
 * Measured values. Units:
 * deg = degrees, ratio = plain ratio, pct_torso = percent of the player's torso length (shoulder-mid to hip-mid),
 * ms = milliseconds.
 */
export type MetricUnit = 'deg' | 'ratio' | 'pct_torso' | 'ms';

export type MetricId =
  | 'shoulder_turn' // apparent shoulder rotation vs. address (deg, 2D-derived proxy; see DECISIONS)
  | 'hip_turn' // apparent hip rotation vs. address (deg)
  | 'x_factor' // shoulder_turn − hip_turn (deg)
  | 'spine_angle' // forward bend of the spine from vertical (DTL, deg)
  | 'spine_angle_change' // spine_angle at position − spine_angle at address (DTL, deg; negative = standing up)
  | 'side_bend' // spine tilt away from target (face-on, deg)
  | 'head_shift_x' // head moves along the target line vs. address (pct_torso, + = towards target)
  | 'head_shift_y' // head moves up/down vs. address (pct_torso, + = up)
  | 'hip_shift_x' // hip centre along the target line vs. address (face-on, pct_torso, + = towards target)
  | 'hip_depth_change' // hip centre towards the ball vs. address (DTL, pct_torso, + = towards the ball = early extension)
  | 'lead_arm_angle' // elbow angle of the lead arm (deg, 180 = straight)
  | 'trail_arm_angle' // elbow angle of the trail arm (deg)
  | 'lead_wrist_hinge' // angle between lead forearm and shaft (deg) – needs club
  | 'hand_height' // hands above address position (pct_torso)
  | 'hand_depth' // hands towards the ball vs. address (DTL, pct_torso, + = outside / away from body)
  | 'hands_ahead' // hands ahead of the ball/club head along the target line (face-on, pct_torso, + = towards target)
  | 'shaft_plane_dev' // shaft vs. neutral line (DTL, deg; + = steep (right of line), − = flat (left of line))
  | 'shaft_lean' // shaft lean at impact (face-on, deg; + = handle towards target)
  | 'knee_flex' // trail/lead knee flex (deg from straight)
  | 'stance_width' // ankle distance / shoulder width (ratio)
  | 'tempo_ratio' // backswing time / downswing time (ratio)
  | 'backswing_ms'
  | 'downswing_ms'
  | 'putter_wrist_change' // putt: change of lead-forearm-to-shaft angle during the stroke (deg)
  | 'body_motion' // putt/chip: max shoulder-mid movement during the stroke (pct_torso)
  | 'swing_length' // how far back the hands go (deg of arm rotation, 0 = address, 90 = lead arm parallel)
  | 'lead_arm_post_impact' // lead elbow angle shortly after impact (face-on, deg, 180 = straight; small = chicken wing)
  | 'hand_path_shift'; // DTL: hand_depth at downswing9 − hand_depth at backswing9 (pct_torso, + = hands further out coming down = over the top)

export interface MetricValue {
  id: MetricId;
  /** where it was measured; 'swing' = over the whole motion */
  at: KeyPosition | 'swing';
  value: number;
  unit: MetricUnit;
  /** 0..1 – how much we trust the value (visibility, view, club source …) */
  confidence: number;
}

export interface SwingMetrics {
  values: MetricValue[];
}

export type QualityIssue =
  | 'no_person'
  | 'body_cut_off' // feet or head outside the frame
  | 'low_visibility' // MediaPipe unsure about key joints
  | 'low_fps' // < 30 fps → tempo and impact uncertain
  | 'too_short' // clip does not contain a full swing
  | 'no_swing_found'
  | 'camera_moving'
  | 'too_far' // player too small in the frame
  | 'mirrored_suspected' // movement direction does not match the chosen handedness
  | 'club_not_found'; // shaft could not be found in the image (club values estimated or missing)

export interface AnalysisQuality {
  /** overall 0..1; below QUALITY_MIN no faults are diagnosed ("not reliably detectable") */
  score: number;
  detectedFrameRatio: number;
  meanVisibility: number;
  fps: number;
  issues: QualityIssue[];
}

// ---------------------------------------------------------------- faults & corrections

export type Localized = Record<Lang, string>;

/** Ball flight / contact outcomes (Fehlschlag-Katalog 04.10.2026). Used for the reverse diagnosis. */
export type BallFlight =
  | 'pull'
  | 'pull_hook'
  | 'push'
  | 'push_slice'
  | 'slice'
  | 'hook'
  | 'duck_hook'
  | 'top'
  | 'fat'
  | 'thin'
  | 'shank'
  | 'toe_heel'
  | 'whiff'
  | 'skyball'
  | 'ballooning'
  | 'too_low'
  | 'scoop'
  | 'chili_dip'
  | 'skull'
  | 'bunker_fat'
  | 'putt_pull'
  | 'putt_push'
  | 'putt_distance'
  | 'inconsistent_contact'
  | 'loss_of_distance';

export type RuleOp = '>' | '<' | 'abs>' | 'outside';

/** One measurable condition. A fault is detected when ALL its rules (or ANY, see FaultDef.match) are true. */
export interface FaultRule {
  metric: MetricId;
  at: KeyPosition | 'swing';
  op: RuleOp;
  /** threshold; for 'outside' the allowed range is [threshold, thresholdHigh] */
  threshold: number;
  thresholdHigh?: number;
  /** value distance beyond the threshold at which severity reaches 1 */
  fullSeverityAt: number;
  /** minimal metric confidence to evaluate this rule (default QUALITY_MIN) */
  minConfidence?: number;
  /** REVIEW(golf): free text explaining where the threshold comes from; every threshold carries it */
  review: string;
}

export interface FaultDef {
  id: string;
  name: Localized;
  shotTypes: ShotType[];
  /** only checked in these views (some faults are only measurable from one side) */
  views: CameraView[];
  match: 'all' | 'any';
  rules: FaultRule[];
  /** key position the video marker jumps to */
  marker: KeyPosition;
  /** 1 (minor) .. 5 (fix this first) – golf importance used for prioritisation */
  importance: number;
  ballFlights: BallFlight[];
  ballEffect: Localized;
  cause: Localized;
  correction: Localized;
  /** what the player gains – in player language (our USP) */
  benefit: Localized;
  drillIds: string[];
  /** target for the training mode derived from this correction */
  trainingTarget?: { metric: MetricId; at: KeyPosition | 'swing'; target: number; tolerance: number };
}

/** A fault found in one swing. */
export interface Fault {
  defId: string;
  /** 0..1 how far beyond the threshold */
  severity: number;
  /** severity × importance × confidence – used for the top-3 ranking */
  priority: number;
  confidence: number;
  marker: KeyPosition;
  frameIndex: number;
  measured: { metric: MetricId; at: KeyPosition | 'swing'; value: number; threshold: number }[];
}

export interface Correction {
  faultId: string;
  text: Localized;
  benefit: Localized;
  drillIds: string[];
}

export interface Drill {
  id: string;
  name: Localized;
  /** Get the Feel (no ball, slow) or Make it Real (on the range with ball) – 18Birdies format, to be confirmed by Chris */
  kind: 'feel' | 'real';
  goal: Localized;
  equipment: Localized;
  steps: Localized[];
  reps: Localized;
  /** true until Chris has approved the text */
  draft: boolean;
}

/** Swing score 0..100 (concept 08.10.2026). */
export interface SwingScore {
  total: number | null;
  parts: { id: 'downswing9' | 'tempo' | 'body' | 'top' | 'backswing9' | 'setup'; score: number | null; weight: number }[];
}

// ---------------------------------------------------------------- swings, sessions, training

export interface Swing {
  id: string;
  sessionId: string;
  createdAt: number;
  shotType: ShotType;
  view: CameraView;
  handedness: Handedness;
  source: 'live' | 'upload' | 'training';
  /** key of the video blob in storage (absent when not stored) */
  videoKey?: string;
  durationMs: number;
  pose: PoseSequence;
  /** club per frame (same length as pose.frames), null where unknown */
  club: (ClubEstimate | null)[];
  neutralLine: Line2 | null;
  /** the player's own corrected neutral line – visual only, never used for metrics (decision 06.10.2026) */
  manualNeutralLine?: Line2 | null;
  keyframes: PhaseKeyframe[];
  metrics: SwingMetrics;
  quality: AnalysisQuality;
  faults: Fault[];
  /** all fault ids that were checked for this swing (detected or not) – needed for the progress curve */
  checkedFaultIds: string[];
  /** fault ids that apply to this shot/view but could not be checked reliably ("not reliably detectable") */
  uncertainFaultIds: string[];
  score: SwingScore | null;
  note?: string;
}

export type SessionMode = 'analysis' | 'mirror' | 'series';

export interface Session {
  id: string;
  createdAt: number;
  mode: SessionMode;
  shotType: ShotType;
  view: CameraView;
  handedness: Handedness;
  swingIds: string[];
  targetId?: string;
  /** series results, one per real swing */
  results?: { swingId: string; hit: boolean; proximity: number }[];
}

/** One measurable criterion of a training target. */
export interface TargetCriterion {
  metric: MetricId;
  at: KeyPosition | 'swing';
  target: number;
  tolerance: number;
  unit: MetricUnit;
}

export interface TrainingTarget {
  id: string;
  label: Localized;
  source: 'reference' | 'correction' | 'template';
  /** fault id when source = correction, swing id when source = reference */
  sourceId?: string;
  shotType: ShotType;
  view: CameraView;
  /** the position that is trained (mirror mode holds this position) */
  position: KeyPosition;
  criteria: TargetCriterion[];
  /** canonical landmarks of the target pose for the ghost overlay (optional) */
  ghost?: Landmark[];
}

/** One row per fault and swing – the raw material for the later personal development curve ("Elo"). */
export interface FaultProgressRecord {
  id: string;
  faultId: string;
  swingId: string;
  ts: number;
  shotType: ShotType;
  view: CameraView;
  /** false = fault checked and not present (just as important for the curve) */
  detected: boolean;
  severity: number;
  confidence: number;
}

export interface Settings {
  lang: Lang;
  handedness: Handedness;
  defaultShotType: ShotType;
  defaultView: CameraView;
  /** multiplier on all training tolerances (1 = default) */
  toleranceScale: number;
  sound: boolean;
  /** player height in cm – only used to show approximate centimetres next to relative values */
  heightCm: number;
}
