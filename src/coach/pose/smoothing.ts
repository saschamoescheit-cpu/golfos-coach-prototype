import type { Landmark, PoseFrame, PoseSequence } from '../model/types';

/**
 * OWNER: agent "capture-pose" (work package B/C).
 * Smooth landmark jitter and fill short gaps (frames without detection) without shifting fast swing events in time.
 * Keeps frames.length and timestamps unchanged.
 *
 * Method (see docs/coach/decisions/capture-pose.md, CP-1):
 * 1. Gap filling: runs of frames without a person (lm = null) of at most `maxGapMs` are filled with a cubic Hermite
 *    interpolation between the neighbouring detections (visibility of filled points is lowered).
 * 2. Smoothing: per landmark a visibility-weighted local quadratic regression (Savitzky-Golay generalised to irregular
 *    timestamps and weights). The window is symmetric in TIME → zero phase: events are not shifted.
 *    The window is ADAPTIVE (idea of the One-Euro filter, but symmetric): wide where the point is slow (address, top,
 *    finish → strong jitter reduction), narrow where it is fast (downswing, impact → no flattening of the speed peak).
 * 3. One robustness pass (bisquare weights on the residuals) removes single-frame outliers such as a wrist that jumps
 *    to the other hand for one frame.
 */

export interface SmoothOptions {
  /** longest run of missing frames that is filled by interpolation (ms) */
  maxGapMs?: number;
  /** widest half window of the regression (ms, used for slow motion); default max(4 frame intervals, 100 ms) */
  halfWindowMs?: number;
  /** extra robustness pass against outliers (default true) */
  robust?: boolean;
}

export const SMOOTH_DEFAULTS = { maxGapMs: 150 } as const;

/** weight factor for points that were filled in by interpolation (they carry no new information) */
const FILLED_WEIGHT = 0.3;
/** visibility of filled points relative to their neighbours */
const FILLED_VIS = 0.8;
/** speed (units per ms) at which the window is halved: image ≈ 0.4 frame heights/s, world ≈ 0.8 m/s */
const V_REF_IMAGE = 0.0004;
const V_REF_WORLD = 0.0008;

export function medianInterval(times: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const x = times[i] - times[i - 1];
    if (x > 0 && Number.isFinite(x)) d.push(x);
  }
  if (!d.length) return NaN;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

export function smoothSequence(seq: PoseSequence, opts: SmoothOptions = {}): PoseSequence {
  const n = seq.frames.length;
  if (n === 0) return seq;
  const times = seq.frames.map((f) => f.t);
  const dt = medianInterval(times) || 1000 / (seq.fps || 30);
  const maxGap = opts.maxGapMs ?? SMOOTH_DEFAULTS.maxGapMs;
  const hMax = opts.halfWindowMs ?? Math.max(4 * dt, 100);
  // smallest window: ±2 neighbours barely count → almost no smoothing at peak speed, but outliers can still be rejected
  const hMin = Math.min(hMax, 2.2 * dt);
  const robust = opts.robust ?? true;

  const lmTracks = fillGaps(times, seq.frames.map((f) => f.lm), maxGap, dt);
  const hasWorld = seq.frames.some((f) => f.world);
  const worldTracks = hasWorld ? fillGaps(times, seq.frames.map((f) => f.world ?? null), maxGap, dt) : null;

  const p = { hMin, hMax, hPilot: Math.max(2.5 * dt, 50), robust, dt };
  const lmOut = smoothTracks(times, lmTracks.lm, lmTracks.filled, { ...p, vRef: V_REF_IMAGE });
  const worldOut = worldTracks ? smoothTracks(times, worldTracks.lm, worldTracks.filled, { ...p, vRef: V_REF_WORLD }) : null;

  const frames: PoseFrame[] = seq.frames.map((f, i) => {
    const out: PoseFrame = { t: f.t, lm: lmOut[i] };
    if (f.world !== undefined || worldOut) out.world = worldOut ? worldOut[i] : (f.world ?? null);
    return out;
  });
  return { ...seq, frames };
}

// ------------------------------------------------------------------ gap filling

interface Filled {
  lm: (Landmark[] | null)[];
  filled: boolean[];
}

/** derivative at x1 of the parabola through (x0,f0), (x1,f1), (x2,f2) */
function deriv3(x0: number, f0: number, x1: number, f1: number, x2: number, f2: number, at: number): number {
  // Lagrange basis derivatives
  const d0 = (2 * at - x1 - x2) / ((x0 - x1) * (x0 - x2));
  const d1 = (2 * at - x0 - x2) / ((x1 - x0) * (x1 - x2));
  const d2 = (2 * at - x0 - x1) / ((x2 - x0) * (x2 - x1));
  return f0 * d0 + f1 * d1 + f2 * d2;
}

/** Fill runs of null frames up to maxGapMs with cubic Hermite interpolation. Exported for tests. */
export function fillGaps(times: number[], lms: (Landmark[] | null | undefined)[], maxGapMs: number, dt: number): Filled {
  const n = lms.length;
  const out: (Landmark[] | null)[] = lms.map((l) => (l && l.length ? l : null));
  const filled = new Array<boolean>(n).fill(false);
  let i = 0;
  while (i < n) {
    if (out[i]) {
      i++;
      continue;
    }
    let e = i;
    while (e + 1 < n && !out[e + 1]) e++;
    const p = i - 1;
    const q = e + 1;
    if (p >= 0 && q < n && times[q] - times[p] - dt <= maxGapMs + 1e-6) {
      const P = out[p]!;
      const Q = out[q]!;
      const pp = p - 1 >= 0 && out[p - 1] && !filled[p - 1] ? out[p - 1]! : null;
      const qq = q + 1 < n && out[q + 1] ? out[q + 1]! : null;
      const tp = times[p];
      const tq = times[q];
      const T = tq - tp;
      for (let k = i; k <= e; k++) {
        const s = (times[k] - tp) / T;
        const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
        const h10 = s ** 3 - 2 * s ** 2 + s;
        const h01 = -2 * s ** 3 + 3 * s ** 2;
        const h11 = s ** 3 - s ** 2;
        const lm: Landmark[] = P.map((a, j) => {
          const b = Q[j];
          const res = { x: 0, y: 0, z: 0, v: Math.min(a.v, b.v) * FILLED_VIS };
          for (const c of ['x', 'y', 'z'] as const) {
            const sec = b[c] - a[c];
            // tangents (per unit s) from a parabola through the neighbours; secant when a neighbour is missing
            const m0 = pp ? deriv3(times[p - 1], pp[j][c], tp, a[c], tq, b[c], tp) * T : sec;
            const m1 = qq ? deriv3(tp, a[c], tq, b[c], times[q + 1], qq[j][c], tq) * T : sec;
            res[c] = h00 * a[c] + h10 * m0 + h01 * b[c] + h11 * m1;
          }
          return res;
        });
        out[k] = lm;
        filled[k] = true;
      }
    }
    i = e + 1;
  }
  return { lm: out, filled };
}

// ------------------------------------------------------------------ adaptive local quadratic regression

const tricube = (u: number) => {
  const a = Math.abs(u);
  if (a >= 1) return 0;
  const b = 1 - a * a * a;
  return b * b * b;
};

interface TrackParams {
  hMin: number;
  hPilot: number;
  hMax: number;
  vRef: number;
  dt: number;
  robust: boolean;
}

/** Fit a + bτ + cτ² around ti with half window h; returns the value at ti or null when too few points. */
function fitAt(
  times: number[],
  idx: number[],
  pos: number,
  h: number,
  weightOf: (k: number) => number,
  valueOf: (k: number, c: number) => number,
): [number, number, number] | null {
  const ti = times[idx[pos]];
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  const r0 = [0, 0, 0], r1 = [0, 0, 0], r2 = [0, 0, 0];
  const visit = (m: number) => {
    const k = idx[m];
    const tau = (times[k] - ti) / h;
    const w = tricube(tau) * weightOf(k);
    if (w <= 0) return;
    const t2 = tau * tau;
    s0 += w; s1 += w * tau; s2 += w * t2; s3 += w * t2 * tau; s4 += w * t2 * t2;
    for (let c = 0; c < 3; c++) {
      const v = valueOf(k, c);
      r0[c] += w * v;
      r1[c] += w * v * tau;
      r2[c] += w * v * t2;
    }
  };
  visit(pos);
  for (let m = pos - 1; m >= 0 && times[idx[m]] > ti - h; m--) visit(m);
  for (let m = pos + 1; m < idx.length && times[idx[m]] < ti + h; m++) visit(m);
  if (s0 <= 0) return null;
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) > 1e-7 * s0 * s0 * s0) {
    // Cramer's rule for the constant term a (= value at τ = 0)
    return [0, 1, 2].map((c) => (r0[c] * (s2 * s4 - s3 * s3) - s1 * (r1[c] * s4 - s3 * r2[c]) + s2 * (r1[c] * s3 - s2 * r2[c])) / det) as [
      number,
      number,
      number,
    ];
  }
  // too few neighbours for a quadratic → weighted local linear fit
  const detL = s0 * s2 - s1 * s1;
  if (Math.abs(detL) > 1e-7 * s0 * s0) return [0, 1, 2].map((c) => (r0[c] * s2 - s1 * r1[c]) / detL) as [number, number, number];
  return [r0[0] / s0, r0[1] / s0, r0[2] / s0];
}

function smoothTracks(times: number[], lms: (Landmark[] | null)[], filled: boolean[], P: TrackParams): (Landmark[] | null)[] {
  const n = lms.length;
  const first = lms.find((l) => l);
  if (!first) return lms;
  const count = first.length;
  const out: (Landmark[] | null)[] = lms.map((l) => (l ? l.map((p) => ({ ...p })) : null));
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (lms[i]) idx.push(i);
  if (idx.length < 3) return out;

  const robustW = new Float64Array(n);
  const speed = new Float64Array(idx.length);
  const hOf = new Float64Array(idx.length);
  const fit = new Float64Array(n * 3);

  for (let j = 0; j < count; j++) {
    const valueOf = (k: number, c: number) => {
      const p = lms[k]![j];
      return c === 0 ? p.x : c === 1 ? p.y : p.z;
    };
    const visW = (k: number) => {
      const v = Math.max(0.02, Math.min(1, lms[k]![j].v));
      return v * v * (filled[k] ? FILLED_WEIGHT : 1);
    };

    // 1. pilot fit with a fixed medium window (+ robustness pass) → outlier weights and a jitter-free speed estimate
    robustW.fill(1);
    const pilot = new Float64Array(n * 2);
    const passes = P.robust ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const wOf = (k: number) => visW(k) * robustW[k];
      for (let m = 0; m < idx.length; m++) {
        const i = idx[m];
        const r = fitAt(times, idx, m, P.hPilot, wOf, valueOf) ?? [valueOf(i, 0), valueOf(i, 1), 0];
        pilot[i * 2] = r[0];
        pilot[i * 2 + 1] = r[1];
      }
      if (pass < passes - 1) {
        // bisquare weights; residual scale from the median residual, never below a jitter floor
        const resid = idx.map((i) => Math.hypot(lms[i]![j].x - pilot[i * 2], lms[i]![j].y - pilot[i * 2 + 1]));
        const sorted = [...resid].sort((a, b) => a - b);
        const s = Math.max(6 * sorted[Math.floor(sorted.length / 2)], 0.02 * (P.vRef / V_REF_IMAGE));
        idx.forEach((i, m) => {
          const u = resid[m] / s;
          robustW[i] = u >= 1 ? 0 : (1 - u * u) ** 2;
        });
      }
    }
    // 2. speed of the pilot curve (centred difference over ≈ ±25 ms)
    const span = Math.max(1, Math.round(25 / P.dt));
    for (let m = 0; m < idx.length; m++) {
      const a = idx[Math.max(0, m - span)];
      const b = idx[Math.min(idx.length - 1, m + span)];
      const dtab = times[b] - times[a];
      speed[m] = dtab > 0 ? Math.hypot(pilot[b * 2] - pilot[a * 2], pilot[b * 2 + 1] - pilot[a * 2 + 1]) / dtab : 0;
    }
    const noiseSpeed = 2 * [...speed].sort((a, b) => a - b)[Math.floor(idx.length / 2)];
    // 3. window per frame: shrink with the fastest motion within ±hMax/2 (so the window narrows before a fast event)
    let lo = 0;
    let hi = 0;
    for (let m = 0; m < idx.length; m++) {
      const ti = times[idx[m]];
      while (times[idx[lo]] < ti - P.hMax / 2) lo++;
      if (hi < m) hi = m;
      while (hi + 1 < idx.length && times[idx[hi + 1]] <= ti + P.hMax / 2) hi++;
      let vmax = 0;
      for (let q = lo; q <= hi; q++) if (speed[q] > vmax) vmax = speed[q];
      const v = Math.max(0, vmax - noiseSpeed);
      hOf[m] = Math.max(P.hMin, P.hMax / (1 + v / P.vRef));
    }
    // 4. final fit
    const wOf = (k: number) => visW(k) * robustW[k];
    for (let m = 0; m < idx.length; m++) {
      const i = idx[m];
      const r = fitAt(times, idx, m, hOf[m], wOf, valueOf) ?? [valueOf(i, 0), valueOf(i, 1), valueOf(i, 2)];
      fit[i * 3] = r[0];
      fit[i * 3 + 1] = r[1];
      fit[i * 3 + 2] = r[2];
    }
    for (const i of idx) {
      const o = out[i]![j];
      o.x = fit[i * 3];
      o.y = fit[i * 3 + 1];
      o.z = fit[i * 3 + 2];
    }
  }
  return out;
}
