import { analyzeSequence, type AnalysisResult } from '../analysis/analyze';
import type { AnalysisContext } from '../analysis/context';
import type { GrayImage } from '../club/ClubProvider';
import { rgbaToGray } from '../club/image';
import type { PoseFrame, PoseSequence } from '../model/types';
import { getPoseProviderFor, type MediaPipePoseProvider } from '../pose/mediapipe';
import { findSwingWindow, fpsFromTimes, graySize, planFrameTimes, retimeSequence, suggestSlowMotionFactor } from './clip';

/**
 * Video → poses (+ grayscale frames for the club detector) → analyzeSequence. Runs in the browser (Safari on iPhone).
 * OWNER: agent "capture-pose". Decisions: docs/coach/decisions/capture-pose.md (CP-4).
 *
 * Decoding: the video is stepped frame by frame by seeking (deterministic – every frame is analysed even when pose
 * detection is slower than real time). requestVideoFrameCallback, when available, tells the exact media time of the
 * frame on screen; it is also used to measure the source frame rate (slow-motion files keep their 120/240 fps timing).
 * The video element is muted + playsinline (iOS) and attached invisibly to the page (iOS decodes more reliably).
 * Long clips (> maxClipMs) are first scanned at a low frame rate with the lite model; the swing is cut out by the
 * hand speed (findSwingWindow). Memory is capped by maxFrames.
 */
export type VideoStage = 'load' | 'model' | 'scan' | 'pose' | 'analyse';

export interface VideoProgress {
  stage: VideoStage;
  /** 0..1 within the stage */
  ratio: number;
}

export interface VideoAnalysisOptions {
  /** part of the video to analyse (ms, video time) – e.g. from the live swing trigger; skips the scan */
  window?: { startMs: number; endMs: number };
  /** longer clips are cut around the swing (default 8000) */
  maxClipMs?: number;
  /** analysis frame rate cap (default 60) */
  maxFps?: number;
  /** memory cap (default 480 frames ≈ 35 MB of grayscale frames) */
  maxFrames?: number;
  /** the player said: this is a ×N slow-motion video played at normal speed */
  slowMotionFactor?: number;
  signal?: AbortSignal;
}

export interface VideoAnalysisOutput {
  result: AnalysisResult;
  /** unsmoothed, unmirrored poses as detected (frame t = video time in ms, unless slow motion was applied) */
  raw: PoseSequence;
  images: (GrayImage | undefined)[];
  /** analysed frame rate */
  fps: number;
  /** measured frame rate of the video file (0 when unknown) */
  sourceFps: number;
  durationMs: number;
  width: number;
  height: number;
  /** the part of the video that was analysed (ms, video time) */
  window: { startMs: number; endMs: number };
  /** true when the window was found automatically in a long clip */
  autoCut: boolean;
  /** likely slow-motion factor when the swing looks far too slow (ask the player), else null */
  slowMotionSuggested: number | null;
  /** how frames were timed: 'rvfc' = exact media time from requestVideoFrameCallback, 'seek' = requested time */
  timing: 'rvfc' | 'seek';
}

export class VideoAnalysisError extends Error {
  constructor(
    readonly code: 'load_failed' | 'no_frames' | 'aborted',
    message?: string,
  ) {
    super(message ?? code);
  }
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number; presentedFrames?: number }) => void): number;
};
const hasRvfc = () => typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export async function analyzeVideo(
  video: Blob,
  ctx: AnalysisContext,
  onProgress?: (p: VideoProgress) => void,
  opts: VideoAnalysisOptions = {},
): Promise<VideoAnalysisOutput> {
  const progress = (stage: VideoStage, ratio: number) => onProgress?.({ stage, ratio: Math.max(0, Math.min(1, ratio)) });
  const check = () => {
    if (opts.signal?.aborted) throw new VideoAnalysisError('aborted');
  };
  progress('load', 0);
  const url = URL.createObjectURL(video);
  const v = document.createElement('video');
  try {
    await openVideo(v, url);
    check();
    const durationMs = v.duration * 1000;
    const width = v.videoWidth;
    const height = v.videoHeight;
    progress('load', 0.5);
    const sourceFps = await measureFps(v);
    progress('load', 1);
    check();

    const grabber = new FrameGrabber(v, width, height);
    const maxClip = opts.maxClipMs ?? 8000;
    let window = opts.window ? clampWindow(opts.window, durationMs) : { startMs: 0, endMs: durationMs };
    let autoCut = false;

    if (!opts.window && durationMs > maxClip) {
      // scan the long clip with the fast model at a low frame rate and cut around the swing
      progress('model', 0);
      const lite = getPoseProviderFor('lite');
      await lite.init('lite');
      const scanFps = Math.max(3, Math.min(8, 600 / (durationMs / 1000)));
      const plan = planFrameTimes(durationMs / 1000, scanFps, { maxFps: scanFps, maxFrames: 600 });
      const frames = await runPose(grabber, lite, plan.times, false, (r) => progress('scan', r), check);
      const w = findSwingWindow(frames.frames, width / height || 1, { preMs: 1200, postMs: 1200, maxMs: maxClip });
      window = w ? { startMs: w.startMs, endMs: w.endMs } : { startMs: 0, endMs: maxClip };
      autoCut = true;
    }

    progress('model', 0.5);
    const full = getPoseProviderFor('full');
    await full.init('full');
    progress('model', 1);
    check();
    const plan = planFrameTimes(durationMs / 1000, sourceFps || 30, {
      startS: window.startMs / 1000,
      endS: window.endMs / 1000,
      maxFps: opts.maxFps ?? 60,
      maxFrames: opts.maxFrames ?? 480,
    });
    const res = await runPose(grabber, full, plan.times, true, (r) => progress('pose', r), check);
    if (!res.frames.length) throw new VideoAnalysisError('no_frames');

    let raw: PoseSequence = {
      width,
      height,
      fps: fpsFromTimes(res.frames.map((f) => f.t)) || plan.fps,
      frames: res.frames,
      mirrored: false,
      multiPersonRatio: res.multiPersonRatio,
    };
    const slowMotionSuggested = opts.slowMotionFactor ? null : suggestSlowMotionFactor(raw, ctx.shotType);
    if (opts.slowMotionFactor && opts.slowMotionFactor > 1) raw = retimeSequence(raw, opts.slowMotionFactor);

    progress('analyse', 0);
    check();
    const result = analyzeSequence({ raw, images: res.images, ctx });
    progress('analyse', 1);
    return {
      result,
      raw,
      images: res.images,
      fps: raw.fps,
      sourceFps,
      durationMs,
      width,
      height,
      window,
      autoCut,
      slowMotionSuggested,
      timing: grabber.timing,
    };
  } finally {
    v.removeAttribute('src');
    v.load();
    v.remove();
    URL.revokeObjectURL(url);
  }
}

/** Re-run only the analysis (e.g. after the player confirmed slow motion) without decoding the video again. */
export function reanalyze(out: VideoAnalysisOutput, ctx: AnalysisContext, slowMotionFactor = 1): VideoAnalysisOutput {
  const raw = retimeSequence(out.raw, slowMotionFactor);
  return { ...out, raw, fps: raw.fps, result: analyzeSequence({ raw, images: out.images, ctx }), slowMotionSuggested: null };
}

function clampWindow(w: { startMs: number; endMs: number }, durationMs: number) {
  const startMs = Math.max(0, Math.min(w.startMs, durationMs));
  const endMs = Math.max(startMs, Math.min(w.endMs, durationMs));
  return endMs - startMs < 200 ? { startMs: 0, endMs: durationMs } : { startMs, endMs };
}

// ------------------------------------------------------------------ video element helpers

function waitFor(el: HTMLElement, ok: string[], fail: string[], ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const off = () => {
      clearTimeout(to);
      for (const e of [...ok, ...fail]) el.removeEventListener(e, handlers[e]);
    };
    const handlers: Record<string, () => void> = {};
    for (const e of ok) handlers[e] = () => (off(), resolve(e));
    for (const e of fail) handlers[e] = () => (off(), reject(new VideoAnalysisError('load_failed', e)));
    for (const e of [...ok, ...fail]) el.addEventListener(e, handlers[e]);
    const to = setTimeout(() => (off(), resolve('timeout')), ms);
  });
}

async function openVideo(v: HTMLVideoElement, url: string) {
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.preload = 'auto';
  // invisible but attached: iOS Safari decodes frames of detached videos less reliably
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(v);
  const loaded = waitFor(v, ['loadeddata'], ['error'], 15000);
  v.src = url;
  v.load();
  if ((await loaded) === 'timeout' && !(v.videoWidth > 0)) throw new VideoAnalysisError('load_failed', 'timeout');
  // MediaRecorder WebM files (Chrome) have no duration until the end was read
  if (!Number.isFinite(v.duration) || v.duration <= 0) {
    const p = waitFor(v, ['durationchange', 'seeked'], [], 3000);
    v.currentTime = 1e7;
    await p;
    const back = waitFor(v, ['seeked'], [], 3000);
    v.currentTime = 0;
    await back;
  }
  if (!(v.videoWidth > 0) || !Number.isFinite(v.duration)) throw new VideoAnalysisError('load_failed', 'no size or duration');
}

/** Frame rate of the file from the media times of consecutively presented frames (played at ¼ speed, muted). */
async function measureFps(v: HTMLVideoElement): Promise<number> {
  if (!hasRvfc()) return 0;
  const times: number[] = [];
  const rv = v as RvfcVideo;
  try {
    v.playbackRate = 0.25;
    await new Promise<void>((resolve) => {
      const stop = setTimeout(resolve, 1500);
      const cb = (_: number, meta: { mediaTime: number }) => {
        times.push(meta.mediaTime);
        if (times.length >= 10) {
          clearTimeout(stop);
          resolve();
        } else rv.requestVideoFrameCallback(cb);
      };
      rv.requestVideoFrameCallback(cb);
      v.play().catch(() => {
        clearTimeout(stop);
        resolve();
      });
    });
  } finally {
    v.pause();
    v.playbackRate = 1;
  }
  return fpsFromTimes(times, 1000);
}

class FrameGrabber {
  private work = document.createElement('canvas');
  private gray = document.createElement('canvas');
  private useRvfc = hasRvfc();
  private rvfcMisses = 0;
  timing: 'rvfc' | 'seek' = hasRvfc() ? 'rvfc' : 'seek';

  constructor(
    private v: HTMLVideoElement,
    w: number,
    h: number,
  ) {
    // pose input: longest side ≤ 720 px (enough for the landmark model's crop, cheaper to upload)
    const s = Math.min(1, 720 / Math.max(w, h));
    this.work.width = Math.max(1, Math.round(w * s));
    this.work.height = Math.max(1, Math.round(h * s));
    const g = graySize(w, h, 360);
    this.gray.width = g.width;
    this.gray.height = g.height;
  }

  /** Seek to time tS; resolves with the exact media time (ms) of the shown frame. */
  async seek(tS: number): Promise<number> {
    const v = this.v as RvfcVideo;
    let mediaMs: number | null = null;
    let rvfcDone: Promise<void> = Promise.resolve();
    if (this.useRvfc) {
      rvfcDone = new Promise<void>((resolve) => {
        const to = setTimeout(() => {
          this.rvfcMisses++;
          if (this.rvfcMisses >= 3 && mediaMs === null) {
            // this browser does not report frames of a paused video → plain seeking
            this.useRvfc = false;
            this.timing = 'seek';
          }
          resolve();
        }, 250);
        v.requestVideoFrameCallback((_, meta) => {
          clearTimeout(to);
          mediaMs = meta.mediaTime * 1000;
          this.rvfcMisses = 0;
          resolve();
        });
      });
    }
    const seeked = waitFor(v, ['seeked'], [], 3000);
    v.currentTime = tS;
    await seeked;
    await rvfcDone;
    return mediaMs ?? tS * 1000;
  }

  drawWork(): HTMLCanvasElement {
    const g = this.work.getContext('2d')!;
    g.drawImage(this.v, 0, 0, this.work.width, this.work.height);
    return this.work;
  }

  grayImage(): GrayImage {
    const g = this.gray.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(this.work, 0, 0, this.gray.width, this.gray.height);
    const d = g.getImageData(0, 0, this.gray.width, this.gray.height);
    return rgbaToGray(d.data, d.width, d.height);
  }
}

async function runPose(
  grabber: FrameGrabber,
  provider: MediaPipePoseProvider,
  times: number[],
  withImages: boolean,
  onRatio: (r: number) => void,
  check: () => void,
): Promise<{ frames: PoseFrame[]; images: (GrayImage | undefined)[]; multiPersonRatio: number }> {
  const frames: PoseFrame[] = [];
  const images: (GrayImage | undefined)[] = [];
  const base = provider.beginClip();
  let multi = 0;
  let lastT = -Infinity;
  for (let i = 0; i < times.length; i++) {
    check();
    const tMs = await grabber.seek(times[i]);
    if (tMs <= lastT + 0.01) continue; // the seek landed on the same frame again
    lastT = tMs;
    const canvas = grabber.drawWork();
    let det: { lm: PoseFrame['lm']; world?: PoseFrame['world']; people: number };
    try {
      det = provider.detect(canvas, base + tMs);
    } catch {
      det = { lm: null, world: null, people: 0 };
    }
    if (det.people > 1) multi++;
    frames.push({ t: Math.round(tMs * 1000) / 1000, lm: det.lm, world: det.world ?? null });
    if (withImages) images.push(grabber.grayImage());
    if (i % 3 === 0) {
      onRatio(i / times.length);
      // let the UI breathe (progress bar, cancel button)
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onRatio(1);
  return { frames, images, multiPersonRatio: frames.length ? multi / frames.length : 0 };
}
