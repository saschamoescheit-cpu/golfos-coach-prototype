import { LM, SHOT_TYPES } from '../model/constants';
import type { Landmark, PoseFrame, PoseSequence, ShotType } from '../model/types';

/**
 * Pure helpers of the video pipeline (no DOM) – tested in Node.
 * OWNER: agent "capture-pose".
 */

/** Common video frame rates; measured rates are snapped to these when within 4 %. */
const COMMON_FPS = [24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, 240];

/** Frame rate from frame timestamps (ms or s – only the ratio matters if `unit` is given). */
export function fpsFromTimes(times: number[], unitMs = 1): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const x = (times[i] - times[i - 1]) * unitMs;
    if (x > 0.5 && Number.isFinite(x)) d.push(x);
  }
  if (!d.length) return 0;
  d.sort((a, b) => a - b);
  const fps = 1000 / d[Math.floor(d.length / 2)];
  for (const c of COMMON_FPS) if (Math.abs(fps - c) / c < 0.04) return c;
  return Math.round(fps * 100) / 100;
}

export interface FramePlan {
  /** times in seconds (media time) where frames are grabbed */
  times: number[];
  /** effective analysis frame rate */
  fps: number;
}

/**
 * Which media times to decode: every frame of the source (at most `maxFps`) inside the window, thinned out when the
 * clip would exceed `maxFrames` (memory on the phone). Times are frame centres so a seek lands safely inside a frame.
 */
export function planFrameTimes(
  durationS: number,
  sourceFps: number,
  opts: { startS?: number; endS?: number; maxFps?: number; maxFrames?: number } = {},
): FramePlan {
  const start = Math.max(0, opts.startS ?? 0);
  const end = Math.min(durationS, opts.endS ?? durationS);
  const src = sourceFps > 0 ? sourceFps : 30;
  let fps = Math.min(src, opts.maxFps ?? 60);
  const maxFrames = opts.maxFrames ?? 600;
  const span = Math.max(0, end - start);
  if (span * fps > maxFrames) fps = maxFrames / span;
  // step in whole source frames so every grabbed frame is a real frame
  const stepFrames = Math.max(1, Math.ceil(src / fps - 1e-9));
  const step = stepFrames / src;
  const times: number[] = [];
  const first = Math.ceil(start * src - 1e-6) / src;
  for (let t = first + 0.5 / src; t < end - 1e-6; t += step) times.push(Math.round(t * 1e6) / 1e6);
  return { times, fps: src / stepFrames };
}

/** Grayscale image size for the club detector: longest side `longest` px, aspect kept. */
export function graySize(w: number, h: number, longest = 360): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: longest, height: longest };
  const s = Math.min(1, longest / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

// ------------------------------------------------------------------ hand speed & swing window

interface HandTrack {
  t: number[];
  /** hand speed in torso lengths per second (NaN where unknown) */
  speed: number[];
}

/** Hand speed per frame in torso lengths per second (aspect-correct, lightly smoothed). */
export function handSpeed(frames: PoseFrame[], aspect: number): HandTrack {
  const n = frames.length;
  const pos: ({ x: number; y: number } | null)[] = [];
  const torsos: number[] = [];
  for (const f of frames) {
    const lm = f.lm;
    if (!lm) {
      pos.push(null);
      continue;
    }
    const P = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y });
    const m = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    pos.push(m(P(LM.LEFT_WRIST), P(LM.RIGHT_WRIST)));
    const sh = m(P(LM.LEFT_SHOULDER), P(LM.RIGHT_SHOULDER));
    const hp = m(P(LM.LEFT_HIP), P(LM.RIGHT_HIP));
    torsos.push(Math.hypot(sh.x - hp.x, sh.y - hp.y));
  }
  torsos.sort((a, b) => a - b);
  const torso = torsos[Math.floor(torsos.length / 2)] || 0.2;
  const raw: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let a = i - 1;
    let b = i + 1;
    while (a >= 0 && !pos[a]) a--;
    while (b < n && !pos[b]) b++;
    if (a < 0 || b >= n || !pos[i] || frames[b].t - frames[a].t > 400) continue;
    const pa = pos[a]!;
    const pb = pos[b]!;
    raw[i] = (Math.hypot(pb.x - pa.x, pb.y - pa.y) / torso / (frames[b].t - frames[a].t)) * 1000;
  }
  // 3-point median against single-frame jitter
  const speed = raw.map((v, i) => {
    const w = [raw[i - 1], v, raw[i + 1]].filter(Number.isFinite);
    if (!w.length) return NaN;
    w.sort((x, y) => x - y);
    return w[Math.floor(w.length / 2)];
  });
  return { t: frames.map((f) => f.t), speed };
}

export interface SwingWindow {
  /** clip to analyse (ms, same clock as the frames), incl. pre/post roll */
  startMs: number;
  endMs: number;
  /** fastest hand movement (≈ impact) */
  peakMs: number;
  /** quiet → motion (takeaway) and motion → quiet (finish) */
  motionStartMs: number;
  motionEndMs: number;
  peakSpeed: number;
}

/**
 * Find the swing in a long clip by the hand speed: the fastest hand movement (≈ impact), then backwards to the last
 * quiet period of ≥ quietMs (address – the short slow-down at the top is skipped because it is shorter) and forwards to
 * the next quiet period (finish). Returns null when nothing moves.
 */
export function findSwingWindow(
  frames: PoseFrame[],
  aspect: number,
  opts: { preMs?: number; postMs?: number; maxMs?: number; quietMs?: number } = {},
): SwingWindow | null {
  const { t, speed } = handSpeed(frames, aspect);
  const n = t.length;
  let pk = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(speed[i]) && (pk < 0 || speed[i] > speed[pk])) pk = i;
  // REVIEW(golf): even a short putt moves the hands > 0.6 torso lengths per second at impact
  if (pk < 0 || speed[pk] < 0.6) return null;
  const quiet = Math.max(0.25, speed[pk] * 0.1);
  const quietMs = opts.quietMs ?? 300;
  const isQuiet = (i: number) => !Number.isFinite(speed[i]) || speed[i] < quiet;

  // backwards: first quiet run of ≥ quietMs
  let motionStart = t[0];
  let runEnd = -1;
  for (let i = pk; i >= 0; i--) {
    if (isQuiet(i)) {
      if (runEnd < 0) runEnd = i;
      if (t[runEnd] - t[i] >= quietMs) {
        motionStart = t[runEnd];
        break;
      }
    } else runEnd = -1;
  }
  // forwards: first quiet run of ≥ quietMs
  let motionEnd = t[n - 1];
  let runStart = -1;
  for (let i = pk; i < n; i++) {
    if (isQuiet(i)) {
      if (runStart < 0) runStart = i;
      if (t[i] - t[runStart] >= quietMs) {
        motionEnd = t[runStart];
        break;
      }
    } else runStart = -1;
  }
  let startMs = Math.max(t[0], motionStart - (opts.preMs ?? 1000));
  let endMs = Math.min(t[n - 1], motionEnd + (opts.postMs ?? 1000));
  const maxMs = opts.maxMs ?? 8000;
  if (endMs - startMs > maxMs) {
    // keep the motion, shorten the rolls (pre first), finally centre on the peak
    const excess = endMs - startMs - maxMs;
    const pre = motionStart - startMs;
    const cutPre = Math.min(pre, excess);
    startMs += cutPre;
    endMs -= Math.min(endMs - motionEnd, excess - cutPre);
    if (endMs - startMs > maxMs) {
      startMs = Math.max(t[0], t[pk] - maxMs * 0.6);
      endMs = startMs + maxMs;
    }
  }
  return { startMs, endMs, peakMs: t[pk], motionStartMs: motionStart, motionEndMs: motionEnd, peakSpeed: speed[pk] };
}

// ------------------------------------------------------------------ slow motion

/** Divide all timestamps by `factor` (a ×factor slow-motion video played at normal speed → real time). */
export function retimeSequence(seq: PoseSequence, factor: number): PoseSequence {
  if (!(factor > 0) || factor === 1) return seq;
  return { ...seq, fps: seq.fps * factor, frames: seq.frames.map((f) => ({ ...f, t: f.t / factor })) };
}

/**
 * A swing that takes several times longer than any real swing was most likely recorded in slow motion and exported
 * at normal speed (iPhone "Slo-mo" shared as a regular video). Returns the likely factor (2, 4 or 8) or null.
 */
export function suggestSlowMotionFactor(seq: PoseSequence, shotType: ShotType): number | null {
  const down = downswingMs(seq.frames, seq.height > 0 ? seq.width / seq.height : 1);
  if (down === null) return null;
  // REVIEW(golf): typical downswing time = typical swing time / (tempo + 1) (e.g. iron ≈ 290 ms)
  const cfg = SHOT_TYPES[shotType];
  const typicalDown = (cfg.typicalSwingMs[0] + cfg.typicalSwingMs[1]) / 2 / (cfg.tempo.target + 1);
  const guess = down / typicalDown;
  const f = [1, 2, 4, 8].reduce((best, c) => (Math.abs(Math.log(c / guess)) < Math.abs(Math.log(best / guess)) ? c : best), 1);
  return f === 1 ? null : f;
}

/** Time from the top (slowest hands before the fastest moment) to the fastest hand movement (≈ impact), or null. */
export function downswingMs(frames: PoseFrame[], aspect: number): number | null {
  const { t, speed } = handSpeed(frames, aspect);
  let pk = -1;
  for (let i = 0; i < t.length; i++) if (Number.isFinite(speed[i]) && (pk < 0 || speed[i] > speed[pk])) pk = i;
  if (pk < 0 || speed[pk] < 0.6) return null;
  // walk back until the hands are slow, then on to the local minimum (= top, the hands turn around)
  let i = pk;
  while (i > 0 && !(speed[i] < 0.3 * speed[pk])) i--;
  while (i > 0 && Number.isFinite(speed[i - 1]) && speed[i - 1] <= speed[i]) i--;
  return i > 0 ? t[pk] - t[i] : null;
}

// ------------------------------------------------------------------ multiple people

/**
 * MediaPipe may return several people. The player is the largest, most central person, and the one closest to the
 * player of the previous frame (bystanders walking past should not steal the skeleton).
 */
export function pickMainPerson(people: Landmark[][], prevCenter?: { x: number; y: number } | null): number {
  if (people.length <= 1) return 0;
  let best = 0;
  let bestScore = -Infinity;
  people.forEach((lm, i) => {
    const xs = lm.filter((p) => p.v > 0.3).map((p) => p.x);
    const ys = lm.filter((p) => p.v > 0.3).map((p) => p.y);
    if (!xs.length) return;
    const h = Math.max(...ys) - Math.min(...ys);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    let score = h * (1 - Math.min(1, Math.abs(cx - 0.5)));
    if (prevCenter) score -= 2 * Math.hypot(cx - prevCenter.x, cy - prevCenter.y);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Centre of the visible landmarks (for pickMainPerson tracking). */
export function personCenter(lm: Landmark[] | null): { x: number; y: number } | null {
  if (!lm) return null;
  const v = lm.filter((p) => p.v > 0.3);
  if (!v.length) return null;
  const xs = v.map((p) => p.x);
  const ys = v.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
