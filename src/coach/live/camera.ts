/**
 * Camera access for live capture and training. Safari only allows the camera over HTTPS (or localhost).
 * Front camera by default (US-1.0: the player sees himself and the display).
 */
export type Facing = 'user' | 'environment';

export interface CameraHandle {
  stream: MediaStream;
  video: HTMLVideoElement;
  facing: Facing;
  /** frame rate the camera actually delivers */
  fps: number;
  stop(): void;
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (typeof window === 'undefined' || window.isSecureContext);
}

export async function openCamera(video: HTMLVideoElement, facing: Facing = 'user', fps = 60): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: facing,
      // portrait 1080p if possible; Safari picks the closest mode
      width: { ideal: 1080 },
      height: { ideal: 1920 },
      frameRate: { ideal: fps, max: 60 },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  await video.play();
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  return {
    stream,
    video,
    facing,
    fps: settings.frameRate ?? 30,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

/** Best supported recording format (Safari records MP4/H.264, Chrome/Edge WebM). */
export function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}
