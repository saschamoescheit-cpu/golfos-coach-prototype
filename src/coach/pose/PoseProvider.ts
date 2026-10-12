import type { Landmark } from '../model/types';

/**
 * Body detection behind an interface, so MediaPipe can later be swapped (e.g. for a native or 3D model in Ben's app).
 * Implementations: MediaPipePoseProvider (browser, pose/mediapipe.ts), SyntheticPoseProvider (tests).
 */
export interface PoseDetection {
  lm: Landmark[] | null;
  world?: Landmark[] | null;
}

export type PoseModel = 'lite' | 'full';

export interface PoseProvider {
  readonly id: string;
  /** Load model files (from the app's own folder → works offline). Safe to call more than once. */
  init(model?: PoseModel): Promise<void>;
  /**
   * Detect the pose in one frame of a running video / camera stream. Timestamps must increase monotonically (ms).
   * Returns lm = null when no person was found.
   */
  detect(frame: CanvasImageSource, timestampMs: number): PoseDetection;
  close(): void;
}
