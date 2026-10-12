import type { CameraView, Handedness, ShotType } from '../model/types';

/** What the player chose before recording – passed to every analysis step. */
export interface AnalysisContext {
  shotType: ShotType;
  view: CameraView;
  handedness: Handedness;
}
