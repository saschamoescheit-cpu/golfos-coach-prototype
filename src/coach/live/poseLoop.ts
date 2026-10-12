import type { Handedness, PoseFrame } from '../model/types';
import { mirrorFrame } from '../pose/mirror';
import type { PoseProvider } from '../pose/PoseProvider';

/**
 * Runs pose detection on a live <video> as fast as the phone allows and hands out frames.
 * `raw` = as seen by the camera (for drawing on the preview), `canonical` = mirrored for left-handers (for analysis).
 * Timestamps are ms since the loop started (performance.now based).
 */
export interface LiveFrame {
  raw: PoseFrame;
  canonical: PoseFrame;
}

export function startPoseLoop(
  video: HTMLVideoElement,
  provider: PoseProvider,
  handedness: Handedness,
  onFrame: (f: LiveFrame) => void,
): () => void {
  let stopped = false;
  const t0 = performance.now();
  const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  const step = () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      const t = performance.now() - t0;
      try {
        const d = provider.detect(video, t);
        const raw: PoseFrame = { t, lm: d.lm, world: d.world };
        onFrame({ raw, canonical: handedness === 'left' ? mirrorFrame(raw) : raw });
      } catch {
        // a single failed frame is not fatal
      }
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if (hasRvfc) (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(step);
    else requestAnimationFrame(step);
  };
  schedule();
  return () => {
    stopped = true;
  };
}
