/**
 * OWNER: agent "phases-metrics" (work package C3).
 * Small pure helpers for 1D/2D time signals: gap filling, Gaussian smoothing, noise estimation, sub-frame crossings and
 * "kink" fits (piecewise parabola) used to time swing events more precisely than one video frame.
 */
import { LM } from '../model/constants';
import { aspectOf, dist, mid, pt } from '../model/geometry';
import type { Landmark, PoseSequence, Vec2 } from '../model/types';

/** Minimum visibility for a landmark to be used in timing signals (wrists are often half hidden by the club). */
export const SIGNAL_MIN_VIS = 0.2;

/** Hand centre = midpoint of both wrists in pixel space (see geometry.ts), or null when a wrist is missing. */
export function handCentre(lm: Landmark[] | null | undefined, aspect: number, minVis = SIGNAL_MIN_VIS): Vec2 | null {
  const a = pt(lm, LM.LEFT_WRIST, aspect, minVis);
  const b = pt(lm, LM.RIGHT_WRIST, aspect, minVis);
  return a && b ? mid(a, b) : null;
}

/** Shoulder centre in pixel space or null. */
export function shoulderCentre(lm: Landmark[] | null | undefined, aspect: number, minVis = SIGNAL_MIN_VIS): Vec2 | null {
  const a = pt(lm, LM.LEFT_SHOULDER, aspect, minVis);
  const b = pt(lm, LM.RIGHT_SHOULDER, aspect, minVis);
  return a && b ? mid(a, b) : null;
}

/** Hip centre in pixel space or null. */
export function hipCentre(lm: Landmark[] | null | undefined, aspect: number, minVis = SIGNAL_MIN_VIS): Vec2 | null {
  const a = pt(lm, LM.LEFT_HIP, aspect, minVis);
  const b = pt(lm, LM.RIGHT_HIP, aspect, minVis);
  return a && b ? mid(a, b) : null;
}

/** Torso length (shoulder centre to hip centre) of one frame in pixel space, or NaN. */
export function torsoLengthOf(lm: Landmark[] | null | undefined, aspect: number): number {
  const s = shoulderCentre(lm, aspect);
  const h = hipCentre(lm, aspect);
  return s && h ? dist(s, h) : NaN;
}

/**
 * Torso length of a sequence: median over the given frame range (default: whole clip). Pixel space.
 * This is the unit of all `pct_torso` metrics. Note: face-on the torso looks shorter by cos(spine bend) (~0.8).
 */
export function torsoLength(seq: PoseSequence, from = 0, to = seq.frames.length - 1): number {
  const aspect = aspectOf(seq);
  const v: number[] = [];
  for (let i = Math.max(0, from); i <= Math.min(seq.frames.length - 1, to); i++) {
    const l = torsoLengthOf(seq.frames[i].lm, aspect);
    if (Number.isFinite(l) && l > 0) v.push(l);
  }
  v.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

/** Linear interpolation over missing samples (NaN). Leading/trailing gaps are held at the nearest value. */
export function fillGaps(v: number[]): number[] {
  const out = v.slice();
  const n = out.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (last === -1) for (let j = 0; j < i; j++) out[j] = out[i];
    else if (i - last > 1) for (let j = last + 1; j < i; j++) out[j] = out[last] + ((out[i] - out[last]) * (j - last)) / (i - last);
    last = i;
  }
  if (last === -1) return out;
  for (let j = last + 1; j < n; j++) out[j] = out[last];
  return out;
}

/** Gaussian smoothing with standard deviation `sigmaFrames` (no-op below 0.3 frames). Edges are renormalised. */
export function gaussSmooth(v: number[], sigmaFrames: number): number[] {
  if (sigmaFrames < 0.3) return v.slice();
  const r = Math.ceil(sigmaFrames * 3);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigmaFrames * sigmaFrames)));
  const n = v.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      s += v[j] * w[k + r];
      ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

/** Central-difference derivative per second (dt in ms per frame). */
export function derivative(v: number[], dtMs: number): number[] {
  const n = v.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    out[i] = b > a ? ((v[b] - v[a]) * 1000) / ((b - a) * dtMs) : 0;
  }
  return out;
}

/**
 * Robust white-noise estimate of a raw signal: MAD of second differences / sqrt(6). Only uses triplets of valid
 * (finite) consecutive samples, so interpolated gaps do not fake a low noise level.
 */
export function noiseLevel(raw: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    const c = raw[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) d.push(Math.abs(a - 2 * b + c));
  }
  if (d.length < 5) return 0;
  d.sort((x, y) => x - y);
  return (1.4826 * d[Math.floor(d.length / 2)]) / Math.sqrt(6);
}

/** Noise left after Gaussian smoothing with sigmaFrames (white noise approximation). */
export function smoothedNoise(sigma: number, sigmaFrames: number): number {
  return sigmaFrames < 0.3 ? sigma : sigma / Math.sqrt(2 * Math.sqrt(Math.PI) * sigmaFrames);
}

/** Sub-frame position where v crosses `level` between samples i and i+1 (linear). */
export function crossAt(v: number[], i: number, level = 0): number {
  const a = v[i] - level;
  const b = v[i + 1] - level;
  if (a === b) return i + 0.5;
  return i + Math.max(0, Math.min(1, a / (a - b)));
}

/**
 * Piecewise-parabola ("kink") fit with a free break time t0, solved by grid search with linear least squares per t0:
 *   y(t) = p0 + cl·(t0 − t)^k₊ + cr·(t − t0)^k₊   (k = opts.power, default 2)
 * `left` / `right` switch the two halves on or off (onset: right only; settle: left only; peak/valley: both).
 * Returns the best t0 (in sample units, sub-frame) and the rms residual. Robust to noise because it uses many samples
 * on both sides of the event instead of a single noisy extremum.
 */
export function kinkFit(
  y: number[],
  lo: number,
  hi: number,
  opts: { left: boolean; right: boolean; t0Lo?: number; t0Hi?: number; step?: number; power?: number },
): { t0: number; rms: number; cl: number; cr: number; p0: number } | null {
  lo = Math.max(0, Math.floor(lo));
  hi = Math.min(y.length - 1, Math.ceil(hi));
  if (hi - lo < 3) return null;
  const t0Lo = opts.t0Lo ?? lo;
  const t0Hi = opts.t0Hi ?? hi;
  const step = opts.step ?? 0.1;
  const pw = opts.power ?? 2;
  const pow = (d: number) => (pw === 2 ? d * d : Math.pow(d, pw));
  let best: { t0: number; rms: number; cl: number; cr: number; p0: number } | null = null;
  for (let t0 = t0Lo; t0 <= t0Hi + 1e-9; t0 += step) {
    // basis: 1, L = (t0-t)^2 for t<t0, R = (t-t0)^2 for t>t0
    let s11 = 0, s1l = 0, s1r = 0, sll = 0, srr = 0, sy = 0, sly = 0, sry = 0;
    for (let i = lo; i <= hi; i++) {
      const L = opts.left && i < t0 ? pow(t0 - i) : 0;
      const R = opts.right && i > t0 ? pow(i - t0) : 0;
      const v = y[i];
      s11 += 1; s1l += L; s1r += R; sll += L * L; srr += R * R; sy += v; sly += L * v; sry += R * v;
    }
    const sol = solve3(
      [[s11, s1l, s1r], [s1l, sll, 0], [s1r, 0, srr]],
      [sy, sly, sry],
      opts.left,
      opts.right,
    );
    if (!sol) continue;
    const [p0, cl, cr] = sol;
    let e = 0;
    for (let i = lo; i <= hi; i++) {
      const L = opts.left && i < t0 ? pow(t0 - i) : 0;
      const R = opts.right && i > t0 ? pow(i - t0) : 0;
      const d = y[i] - (p0 + cl * L + cr * R);
      e += d * d;
    }
    const rms = Math.sqrt(e / (hi - lo + 1));
    if (!best || rms < best.rms - 1e-12) best = { t0, rms, cl, cr, p0 };
  }
  return best;
}

/** Solve the 3×3 normal equations with unused columns removed (or degenerate ones). */
function solve3(A: number[][], b: number[], useL: boolean, useR: boolean): [number, number, number] | null {
  const idx = [0];
  if (useL && A[1][1] > 1e-12) idx.push(1);
  if (useR && A[2][2] > 1e-12) idx.push(2);
  const m = idx.length;
  const M = idx.map((r) => idx.map((c) => A[r][c]));
  const v = idx.map((r) => b[r]);
  // Gaussian elimination
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    [v[c], v[p]] = [v[p], v[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < m; k++) M[r][k] -= f * M[c][k];
      v[r] -= f * v[c];
    }
  }
  const out: [number, number, number] = [0, 0, 0];
  idx.forEach((col, k) => (out[col] = v[k] / M[k][k]));
  return out;
}

/** Index of the max (or min) of v within [lo, hi]. */
export function argExt(v: number[], lo: number, hi: number, max: boolean): number {
  lo = Math.max(0, lo);
  hi = Math.min(v.length - 1, hi);
  let bi = lo;
  for (let i = lo + 1; i <= hi; i++) if (max ? v[i] > v[bi] : v[i] < v[bi]) bi = i;
  return bi;
}
