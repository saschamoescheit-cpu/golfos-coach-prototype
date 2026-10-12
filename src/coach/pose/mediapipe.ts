import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '../model/types';
import type { PoseDetection, PoseModel, PoseProvider } from './PoseProvider';

/**
 * MediaPipe Pose Landmarker in the browser. Runtime (WASM) and models are served from the app itself
 * (public/mediapipe, public/models) and precached by the service worker → works offline.
 * OWNER: agent "capture-pose" may extend (e.g. multiple people, delegate tuning) without changing the interface.
 */
const base = () => (import.meta.env?.BASE_URL ?? './').replace(/\/?$/, '/');

export class MediaPipePoseProvider implements PoseProvider {
  readonly id = 'mediapipe-pose';
  private landmarker: PoseLandmarker | null = null;
  private model: PoseModel | null = null;
  private lastTs = -1;

  async init(model: PoseModel = 'full'): Promise<void> {
    if (this.landmarker && this.model === model) return;
    this.close();
    const fileset = await FilesetResolver.forVisionTasks(`${base()}mediapipe`);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base()}models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      // older iPhones / WebGL problems → CPU is slower but works
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
    this.model = model;
    this.lastTs = -1;
  }

  detect(frame: CanvasImageSource, timestampMs: number): PoseDetection {
    if (!this.landmarker) throw new Error('MediaPipePoseProvider.init() not called');
    // MediaPipe requires strictly increasing timestamps
    const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs;
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(frame as HTMLVideoElement, ts);
    const lm = res.landmarks?.[0];
    const world = res.worldLandmarks?.[0];
    const conv = (l: { x: number; y: number; z: number; visibility?: number }): Landmark => ({
      x: l.x,
      y: l.y,
      z: l.z,
      v: l.visibility ?? 1,
    });
    return { lm: lm ? lm.map(conv) : null, world: world ? world.map(conv) : null };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.model = null;
  }
}

let shared: MediaPipePoseProvider | null = null;
/** One provider per app (model loading is expensive). */
export function getPoseProvider(): MediaPipePoseProvider {
  if (!shared) shared = new MediaPipePoseProvider();
  return shared;
}
