import { recorderMimeType } from './camera';

/**
 * Records the camera stream into a video Blob (MediaRecorder; Safari: MP4/H.264, Chrome: WebM).
 * `startedAt` is performance.now() at start, so trigger times (pose loop clock) can be mapped to video time.
 * OWNER: agent "capture-pose".
 */
export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime: string | undefined;
  /** performance.now() when recording started */
  startedAt = 0;

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  get recording(): boolean {
    return !!this.rec && this.rec.state !== 'inactive';
  }

  /** ms recorded so far */
  elapsed(now = performance.now()): number {
    return this.recording ? now - this.startedAt : 0;
  }

  start(stream: MediaStream): void {
    if (this.recording) return;
    this.mime = recorderMimeType();
    this.chunks = [];
    const opts: MediaRecorderOptions = { videoBitsPerSecond: 8_000_000 };
    if (this.mime) opts.mimeType = this.mime;
    const rec = new MediaRecorder(stream, opts);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    rec.start(500);
    this.rec = rec;
    this.startedAt = performance.now();
  }

  /** Stop and return the video (null when nothing was recorded). */
  stop(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = this.mime ?? rec.mimeType ?? 'video/mp4';
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.chunks = [];
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  /** Stop and throw the recording away. */
  discard(): void {
    const rec = this.rec;
    this.rec = null;
    this.chunks = [];
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null;
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }
}
