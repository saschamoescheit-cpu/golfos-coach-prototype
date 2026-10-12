import type { CameraView, KeyPosition, ShotType } from './types';

/** Working title – the final brand name is still open. Use this constant, never the literal. */
export const APP_NAME = 'GolfOS';
export const MODULE_NAME = 'Coach';

/** MediaPipe BlazePose landmark indices. In the canonical (right-handed) frame LEFT = lead side, RIGHT = trail side. */
export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT: 31,
  RIGHT_FOOT: 32,
} as const;
export const LANDMARK_COUNT = 33;

/** Lead/trail aliases for the canonical right-handed frame. */
export const LEAD = {
  SHOULDER: LM.LEFT_SHOULDER,
  ELBOW: LM.LEFT_ELBOW,
  WRIST: LM.LEFT_WRIST,
  HIP: LM.LEFT_HIP,
  KNEE: LM.LEFT_KNEE,
  ANKLE: LM.LEFT_ANKLE,
} as const;
export const TRAIL = {
  SHOULDER: LM.RIGHT_SHOULDER,
  ELBOW: LM.RIGHT_ELBOW,
  WRIST: LM.RIGHT_WRIST,
  HIP: LM.RIGHT_HIP,
  KNEE: LM.RIGHT_KNEE,
  ANKLE: LM.RIGHT_ANKLE,
} as const;

/** Skeleton lines drawn in overlays (pairs of landmark indices). */
export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];

export const ALL_SHOT_TYPES: ShotType[] = ['driver', 'iron', 'pitch', 'chip', 'bunker', 'putt'];
export const ALL_VIEWS: CameraView[] = ['face_on', 'down_the_line'];
export const ALL_POSITIONS: KeyPosition[] = ['address', 'backswing9', 'top', 'downswing9', 'impact', 'finish'];

/**
 * Per shot type: which key positions exist (short shots have fewer phases), expected swing duration and
 * what the motion looks like. REVIEW(golf): the position sets and durations are assumptions for Sascha/Chris.
 */
export interface ShotTypeConfig {
  positions: KeyPosition[];
  /** full rotary swing (driver/iron/bunker), half swing (pitch), short (chip), rocking stroke (putt) */
  motion: 'full' | 'half' | 'short' | 'stroke';
  /** typical backswing + downswing duration in ms (used to sanity-check phase detection) */
  typicalSwingMs: [number, number];
  /** tempo target (backswing:downswing) and tolerance – REVIEW(golf) */
  tempo: { target: number; tolerance: number };
}

export const SHOT_TYPES: Record<ShotType, ShotTypeConfig> = {
  // Tour tempo ~3:1 for full swings (Swing-Score concept 08.10.2026: green 2.7–3.3).
  driver: { positions: ALL_POSITIONS, motion: 'full', typicalSwingMs: [700, 1600], tempo: { target: 3, tolerance: 0.3 } },
  iron: { positions: ALL_POSITIONS, motion: 'full', typicalSwingMs: [700, 1600], tempo: { target: 3, tolerance: 0.3 } },
  bunker: { positions: ALL_POSITIONS, motion: 'full', typicalSwingMs: [700, 1600], tempo: { target: 3, tolerance: 0.4 } },
  // REVIEW(golf): pitch keeps both 9 o'clock positions (half swing reaches about 9 o'clock); short-game tempo ~2:1.
  pitch: { positions: ALL_POSITIONS, motion: 'half', typicalSwingMs: [600, 1400], tempo: { target: 2, tolerance: 0.4 } },
  chip: { positions: ['address', 'top', 'impact', 'finish'], motion: 'short', typicalSwingMs: [400, 1200], tempo: { target: 2, tolerance: 0.4 } },
  // Putting: backstroke ≈ 2× forward stroke time (commonly taught 2:1). REVIEW(golf)
  putt: { positions: ['address', 'top', 'impact', 'finish'], motion: 'stroke', typicalSwingMs: [500, 1500], tempo: { target: 2, tolerance: 0.4 } },
};

/** Below this analysis quality no fault is diagnosed – the app says "not reliably detectable" instead. */
export const QUALITY_MIN = 0.5;
/** Minimum landmark visibility to use a point. */
export const VISIBILITY_MIN = 0.5;
/** At most this many faults are shown after a swing (brief D). */
export const MAX_FAULTS_SHOWN = 3;
