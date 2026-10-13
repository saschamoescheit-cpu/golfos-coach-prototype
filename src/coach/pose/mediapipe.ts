import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '../model/types';
import { personCenter, pickMainPerson } from '../pipeline/clip';
import type { PoseDetection, PoseModel, PoseProvider } from './PoseProvider';

/**
 * MediaPipe Pose Landmarker in the browser. Runtime (WASM) and models are served from the app itself
 * (public/mediapipe, public/models) and precached by the service worker → works offline.
 * OWNER: agent "capture-pose".
 *
 * Detects up to two people (numPoses 2) and returns the player = the largest, most central person, kept stable over
 * time (a bystander walking past does not steal the skeleton). `people` tells how many were seen (quality issue
 * "multiple_people", live hint "Several people in the picture").
 */
const base = () => (import.meta.env?.BASE_URL ?? './').replace(/\/?$/, '/');

export interface MultiPoseDetection extends PoseDetection {
  /** number of people MediaPipe found in this frame */
  people: number;
}

export class MediaPipePoseProvider implements PoseProvider {
  readonly id = 'mediapipe-pose';
  private landmarker: PoseLandmarker | null = null;
  private model: PoseModel | null = null;
  private loading: Promise<void> | null = null;
  private lastTs = -1;
  private lastCenter: { x: number; y: number } | null = null;
  /** 'GPU' or 'CPU' once loaded (shown in the debug line) */
  delegate: 'GPU' | 'CPU' | null = null;

  constructor(private readonly maxPeople = 2) {}

  async init(model: PoseModel = 'full'): Promise<void> {
    if (this.landmarker && this.model === model) return;
    if (this.loading) {
      await this.loading;
      if (this.landmarker && this.model === model) return;
    }
    this.loading = this.load(model);
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async load(model: PoseModel): Promise<void> {
    this.close();
    const fileset = await FilesetResolver.forVisionTasks(`${base()}mediapipe`);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base()}models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: this.maxPeople,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch {
      // older iPhones / WebGL problems → CPU is slower but works
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
    this.model = model;
    this.lastTs = -1;
    this.lastCenter = null;
  }

  /** Forget the tracked player (new clip). */
  resetTracking(): void {
    this.lastCenter = null;
  }

  /**
   * Start a new clip: returns a timestamp base to add to the clip's own frame times. MediaPipe needs increasing
   * timestamps and smooths over time, so a new clip continues 1 s after the last frame of the previous one.
   */
  beginClip(): number {
    this.resetTracking();
    return Math.max(0, this.lastTs) + 1000;
  }

  detect(frame: CanvasImageSource, timestampMs: number): MultiPoseDetection {
    if (!this.landmarker) throw new Error('MediaPipePoseProvider.init() not called');
    // MediaPipe requires strictly increasing timestamps
    const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs;
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(frame as HTMLVideoElement, ts);
    const conv = (l: { x: number; y: number; z: number; visibility?: number }): Landmark => ({
      x: l.x,
      y: l.y,
      z: l.z,
      v: l.visibility ?? 1,
    });
    const all = (res.landmarks ?? []).map((p) => p.map(conv));
    if (!all.length) return { lm: null, world: null, people: 0 };
    const i = pickMainPerson(all, this.lastCenter);
    const lm = all[i];
    this.lastCenter = personCenter(lm);
    const w = res.worldLandmarks?.[i];
    return { lm, world: w ? w.map(conv) : null, people: all.length };
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

const byModel: Partial<Record<PoseModel, MediaPipePoseProvider>> = {};
/**
 * (additive) One provider per model, so the live preview (lite) and the video analysis (full) do not reload each
 * other's model when switching between them. Call init(model) before use (cheap when already loaded).
 */
export function getPoseProviderFor(model: PoseModel): MediaPipePoseProvider {
  return (byModel[model] ??= new MediaPipePoseProvider());
}
