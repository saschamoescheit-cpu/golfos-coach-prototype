import { LM, SHOT_TYPES } from '../model/constants';
import { aspectOf } from '../model/geometry';
import type { ClubEstimate, KeyPosition, PhaseKeyframe, PoseSequence, Vec2 } from '../model/types';
import type { AnalysisContext } from './context';
import {
  argExt,
  crossAt,
  derivative,
  fillGaps,
  gaussSmooth,
  handCentre,
  kinkFit,
  noiseLevel,
  SIGNAL_MIN_VIS,
  smoothedNoise,
  torsoLength,
} from './signals';

/**
 * OWNER: agent "phases-metrics" (work package C3).
 * Key position detection from the hand (wrist-midpoint) trajectory, optionally the club for the 9 o'clock positions.
 * Method overview (details and numbers in docs/coach/decisions/phases-metrics.md):
 *  1. anchor  = fastest hand motion while the hands have been coming DOWN for 0.1 s (= late downswing; excludes the
 *               follow-through and the backswing in every view).
 *  2. impact  = hands lowest near the anchor (piecewise-parabola fit, sub-frame); face-on with a known address the
 *               moment the hands pass their address position along the target line ("hands-return").
 *  3. top     = turning point of the hands: the hand path is projected on its direction of travel just before the
 *               top and a piecewise parabola (slow arrival, fast reversal) is fitted → sub-frame reversal time.
 *  4. address = last still window (≥ 0.1 s) before the top that is far from the top position; the takeaway start
 *               is the onset of a quadratic departure from it; address frame = last frame before the takeaway.
 *  5. finish  = first still window after impact, settle time by the mirrored onset fit.
 *  6. 9 o'clock = shaft horizontal (club grip/head at the same image height) when the club is known with
 *               confidence ≥ 0.5, otherwise a hand-height proxy ("hands-proxy", lower confidence).
 */

/** Hand-height proxy for 9 o'clock (fraction of the hand rise from address to top). REVIEW(golf)+calibration. */
// REVIEW(golf): fractions calibrated on the synthetic swing (shaft parallel at ~1/3 of the hand rise on the way back and
// ~1/6 on the way down because the wrists stay hinged). Real swings may differ (real P2 often earlier) – check on video.
export const NINE_OCLOCK_PROXY: Record<'full' | 'half', { back: number; down: number }> = {
  full: { back: 0.33, down: 0.16 },
  half: { back: 0.36, down: 0.2 },
};

/** Body points used for stillness / onset detection. */
const POSE_POINTS = [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
/**
 * Face-on full swings: time impact as the moment the hands pass their address position (else: hands lowest).
 * Always used for the putt, where the hands hardly drop and the lowest point is too flat to time.
 */
const IMPACT_HANDS_RETURN = false;

/** Share of the motion used for the [onset, settle] fit (tuned on synthetic swings, see decisions). */
const EDGE_FIT_SHARE = [0.12, 0.04];
/** Exponents tried for the onset/settle fit (2 = smooth start/stop first; another one must fit clearly better). */
const ONSET_POWERS = [2, 1, 3, 4];

/** Precise event times (ms) found by detectPhases – useful for debugging and tempo. */
export interface PhaseTiming {
  takeawayT?: number;
  addressT?: number;
  backswing9T?: number;
  topT?: number;
  downswing9T?: number;
  impactT?: number;
  finishT?: number;
}

export interface PhaseDetection {
  keyframes: PhaseKeyframe[];
  timing: PhaseTiming;
  /** torso length used for the hand signal (pixel space) */
  torso: number;
}

/**
 * Find the key positions of SHOT_TYPES[ctx.shotType].positions in a smoothed canonical sequence.
 * 9 o'clock = shaft parallel to the ground (club when confident, otherwise a documented hand-height proxy).
 * Returns them in swing order; positions that cannot be found are omitted.
 */
export function detectKeyframes(seq: PoseSequence, club: (ClubEstimate | null)[], ctx: AnalysisContext): PhaseKeyframe[] {
  return detectPhases(seq, club, ctx).keyframes;
}

export function detectPhases(seq: PoseSequence, club: (ClubEstimate | null)[], ctx: AnalysisContext): PhaseDetection {
  const frames = seq.frames;
  const n = frames.length;
  const empty: PhaseDetection = { keyframes: [], timing: {}, torso: NaN };
  if (n < 8) return empty;
  const aspect = aspectOf(seq);
  const T = torsoLength(seq);
  if (!Number.isFinite(T) || T <= 0) return empty;

  // ---- time base (frames may carry real timestamps; use the median interval)
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(frames[i].t - frames[i - 1].t);
  dts.sort((a, b) => a - b);
  const dt = dts[Math.floor(dts.length / 2)] > 0 ? dts[Math.floor(dts.length / 2)] : 1000 / (seq.fps || 30);
  const fps = 1000 / dt;
  const F = (sec: number) => Math.max(1, Math.round(sec * fps)); // seconds → frames
  const tAt = (x: number): number => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(x)));
    const j = Math.min(n - 1, i + 1);
    const f = Math.max(0, Math.min(1, x - i));
    return frames[i].t + (frames[j].t - frames[i].t) * f;
  };

  // ---- hand signal in torso units
  const rx: number[] = [];
  const ry: number[] = [];
  for (const f of frames) {
    const h = handCentre(f.lm, aspect);
    rx.push(h ? h.x / T : NaN);
    ry.push(h ? h.y / T : NaN);
  }
  const valid = rx.map(Number.isFinite);
  const validCount = valid.filter(Boolean).length;
  if (validCount < 8) return empty;
  const sigma = (noiseLevel(rx) + noiseLevel(ry)) / 2;
  const gx = fillGaps(rx);
  const gy = fillGaps(ry);
  const sigDet = 0.03 * fps;
  const sigFine = 0.012 * fps;
  const sx = gaussSmooth(gx, sigDet);
  const sy = gaussSmooth(gy, sigDet);
  const fx = gaussSmooth(gx, sigFine);
  const fy = gaussSmooth(gy, sigFine);
  const vx = derivative(sx, dt);
  const vy = derivative(sy, dt);
  const speed = vx.map((v, i) => Math.hypot(v, vy[i]));
  const sigS = smoothedNoise(sigma, sigDet);
  const S = (i: number): Vec2 => ({ x: sx[i], y: sy[i] });
  const D = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  const at = (arr: number[], x: number) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(x)));
    const j = Math.min(n - 1, i + 1);
    return arr[i] + (arr[j] - arr[i]) * (x - i);
  };
  const posAt = (x: number): Vec2 => ({ x: at(sx, x), y: at(sy, x) });

  const shot = SHOT_TYPES[ctx.shotType];
  const coverage = (x: number) => {
    const r = F(0.1);
    let c = 0;
    let m = 0;
    for (let i = Math.max(0, Math.round(x) - r); i <= Math.min(n - 1, Math.round(x) + r); i++) {
      m++;
      if (valid[i]) c++;
    }
    return m ? c / m : 0;
  };
  const fpsFactor = fps < 25 ? 0.7 : fps < 50 ? 0.9 : 1;
  const depthMotion = ctx.view === 'down_the_line' && (shot.motion === 'stroke' || shot.motion === 'short');
  const viewFactor = depthMotion ? (shot.motion === 'stroke' ? 0.5 : 0.7) : 1;
  const conf = (base: number, x: number) => Math.max(0, Math.min(1, base * (0.5 + 0.5 * coverage(x)) * fpsFactor * viewFactor));

  // ---- 1. anchor: fastest motion while the hands have been coming down for the last 0.1 s
  const dw = F(0.1);
  let anchor = -1;
  for (let i = dw; i < n; i++) {
    // image y grows downward → hands lower than 0.1 s ago (not for the putt: the hands hardly drop)
    if (shot.motion !== 'stroke' && sy[i] - sy[i - dw] <= 0) continue;
    if (anchor < 0 || speed[i] > speed[anchor]) anchor = i;
  }
  if (anchor < 0) anchor = argExt(speed, 0, n - 1, true);
  const peakSpeed = speed[anchor];
  if (!(peakSpeed > 0.3)) return { ...empty, torso: T }; // nothing moves (speed in torso lengths per second)

  // ---- 2. rough impact: hands lowest near the anchor (valley fit on the lightly smoothed y)
  const iLow = argExt(sy, anchor - F(0.15), anchor + F(0.2), true);
  const vw = Math.max(4, F(0.08));
  const vfit = kinkFit(fy, iLow - vw, iLow + vw, { left: true, right: true, t0Lo: iLow - 2.5, t0Hi: iLow + 2.5 });
  const impY = vfit && vfit.cl < 0 && vfit.cr < 0 ? vfit.t0 : iLow;
  const hImp = posAt(impY);

  // ---- 3. top: farthest point from the impact position going back, then reversal fit along the travel direction
  let rt = Math.max(0, Math.floor(impY) - 1);
  {
    let best = 0;
    const lim = Math.max(0, Math.floor(impY) - F(2.5));
    for (let i = Math.floor(impY) - 1; i >= lim; i--) {
      const d = D(S(i), hImp);
      if (d > best) {
        best = d;
        rt = i;
      } else if (d < 0.5 * best) break;
    }
  }
  const ampTop = D(S(rt), hImp);
  let topX = rt;
  let topOk = false;
  if (ampTop > 4 * sigS && rt > 1) {
    const back = Math.max(0, rt - F(0.12));
    const tv = { x: sx[rt] - sx[back], y: sy[rt] - sy[back] };
    const tl = Math.hypot(tv.x, tv.y);
    if (tl > 0) {
      const u = { x: tv.x / tl, y: tv.y / tl };
      const q = fx.map((x, i) => (x - sx[rt]) * u.x + (fy[i] - sy[rt]) * u.y);
      const drop = 0.2 * ampTop;
      let lo = rt;
      while (lo > 0 && rt - lo < F(0.35) && q[lo - 1] > -drop) lo--;
      let hi = rt;
      const hiLim = Math.min(n - 1, Math.floor(impY) - 1);
      while (hi < hiLim && hi - rt < F(0.25) && q[hi + 1] > -drop) hi++;
      lo = Math.min(lo, rt - 3);
      hi = Math.max(hi, Math.min(hiLim, rt + 3));
      const fit = kinkFit(q, lo, hi, { left: true, right: true, t0Lo: Math.max(lo, rt - F(0.15)), t0Hi: Math.min(hi, rt + F(0.1)) });
      if (fit) {
        topX = fit.t0;
        topOk = true;
      }
    }
  }

  // ---- 4. address: last still window before the top, far from the top position.
  // Stillness and the takeaway onset use a whole upper-body vector (wrists, elbows, shoulders, hips): down-the-line the
  // hands move mostly in depth at the start and the end of the swing, while the shoulder turn is visible.
  const PV = POSE_POINTS.length * 2;
  const pRaw: number[][] = Array.from({ length: PV }, () => []);
  for (const f of frames) {
    POSE_POINTS.forEach((li, k) => {
      const p = f.lm ? f.lm[li] : undefined;
      const ok = p && p.v >= SIGNAL_MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y);
      pRaw[2 * k].push(ok ? (p!.x * aspect) / T : NaN);
      pRaw[2 * k + 1].push(ok ? p!.y / T : NaN);
    });
  }
  // short strokes: weight every coordinate by how much it moves between top and impact (signal-to-noise: in a putt
  // only the arms move, still points would only add noise); weights have mean square 1 (noise thresholds keep scale)
  if (shot.motion === 'stroke' || shot.motion === 'short') {
    const ti = Math.round(topX);
    const ii = Math.round(impY);
    const amp = pRaw.map((v) => {
      const g = fillGaps(v);
      return Math.abs(gaussSmooth(g, sigDet)[ti] - gaussSmooth(g, sigDet)[ii]);
    });
    const ms = Math.sqrt(amp.reduce((acc, x) => acc + x * x, 0) / amp.length) || 1;
    pRaw.forEach((v, k) => {
      const w = Math.max(0.2, amp[k] / ms);
      for (let i = 0; i < v.length; i++) v[i] *= w;
    });
  }
  const pNoise = median(pRaw.map(noiseLevel));
  const pFill = pRaw.map(fillGaps);
  const pS = pFill.map((v) => gaussSmooth(v, sigDet));
  const pF = pFill.map((v) => gaussSmooth(v, sigFine));
  const pSig = smoothedNoise(pNoise, sigDet);
  const vecAt = (arr: number[][], i: number) => arr.map((v) => v[i]);
  /** RMS distance per point (torso units) */
  const rmsPt = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((s, x, k) => s + (x - b[k]) * (x - b[k]), 0) / POSE_POINTS.length);
  const ww = Math.max(3, F(0.1));
  const topI = Math.round(topX);
  const hTop = posAt(topX);
  const ampPose = rmsPt(vecAt(pS, topI), vecAt(pS, Math.round(impY)));
  const rho = Math.max(4 * pSig, 0.04 * ampPose, 0.01);
  const findStill = (from: number, to: number, dir: 1 | -1, far: Vec2, farDist: number): [number, number] | null => {
    for (let e = from; dir < 0 ? e >= to : e <= to; e += dir) {
      const a = dir < 0 ? e - ww + 1 : e;
      const b = dir < 0 ? e : e + ww - 1;
      if (a < 0 || b > n - 1) continue;
      const hm = { x: median(sx.slice(a, b + 1)), y: median(sy.slice(a, b + 1)) };
      if (D(hm, far) < farDist) continue;
      const med = pS.map((v) => median(v.slice(a, b + 1)));
      let ok = true;
      for (let i = a; i <= b && ok; i++) if (rmsPt(vecAt(pS, i), med) > rho) ok = false;
      if (!ok) continue;
      // a slow start/end of the motion can look still in one window: keep sliding away from the swing while the
      // windows stay still (≤ 0.6 s), so the region reaches into the real address / finish hold
      let a2 = a;
      let b2 = b;
      const maxLen = F(0.6);
      const stillAt = (x0: number, x1: number) => {
        const m = pS.map((v) => median(v.slice(x0, x1 + 1)));
        for (let i = x0; i <= x1; i++) if (rmsPt(vecAt(pS, i), m) > rho) return false;
        return true;
      };
      if (dir < 0) while (a2 > 0 && b2 - a2 < maxLen && stillAt(a2 - 1, a2 + ww - 2)) a2--;
      else while (b2 < n - 1 && b2 - a2 < maxLen && stillAt(b2 - ww + 2, b2 + 1)) b2++;
      return [a2, b2];
    }
    return null;
  };
  /**
   * Onset (dir = 1, motion starts at t0) or settle (dir = −1, motion ends at t0) of the body vector relative to the
   * still pose `ref`: project on the direction of motion and fit "constant + c·(t − t0)²" on the moving side.
   */
  const motionEdge = (ref: number[], still: [number, number], limit: number, dir: 1 | -1): { x: number; ok: boolean } => {
    let [a0, e0] = still;
    // trim the still region where it already drifts away from the reference pose (slow start / end of the motion)
    if (dir === 1) while (e0 > a0 + 2 && rmsPt(vecAt(pS, e0), ref) > rho) e0--;
    else while (a0 < e0 - 2 && rmsPt(vecAt(pS, a0), ref) > rho) a0++;
    const edge = dir === 1 ? e0 : a0;
    // project the body vector on the direction of motion (taken at 25 % of the way to the top / from impact)
    const far = rmsPt(vecAt(pS, limit), ref);
    let j25 = edge;
    while (dir === 1 ? j25 < limit : j25 > limit) {
      if (rmsPt(vecAt(pS, j25), ref) >= 0.25 * far) break;
      j25 += dir;
    }
    const u = vecAt(pS, j25).map((x, k) => x - ref[k]);
    const ul = Math.hypot(...u) || 1;
    const q: number[] = new Array(n);
    for (let i = 0; i < n; i++) q[i] = pF.reduce((acc, v, k) => acc + (v[i] - ref[k]) * u[k], 0) / ul;
    // fit only the first / last few percent of the motion (q(j25) ≈ ul ≈ 25 % of the way)
    let j15 = edge;
    while (j15 !== j25 && q[j15] < EDGE_FIT_SHARE[dir === 1 ? 0 : 1] * 4 * ul) j15 += dir;
    const lo = dir === 1 ? a0 : Math.min(j15, a0 - 2);
    const hi = dir === 1 ? Math.max(j15, e0 + 2) : e0;
    let fit: ReturnType<typeof kinkFit> = null;
    for (const power of ONSET_POWERS) {
      const f = kinkFit(q, lo, hi, { left: dir === -1, right: dir === 1, t0Lo: lo + 1, t0Hi: hi - 1, power });
      if (f && (dir === 1 ? f.cr > 0 : f.cl > 0) && (!fit || f.rms < 0.75 * fit.rms)) fit = f;
    }
    if (fit) return { x: fit.t0, ok: true };
    return { x: dir === 1 ? e0 + 1 : a0, ok: false };
  };
  const addrWin = findStill(topI - 1, ww - 1, -1, hTop, 0.5 * ampTop);
  let takeX: number | undefined;
  let hAddr: Vec2 | undefined;
  let addrConfBase = 0;
  if (addrWin) {
    const [a0, e0] = addrWin;
    hAddr = { x: median(sx.slice(a0, e0 + 1)), y: median(sy.slice(a0, e0 + 1)) };
    const ref = pS.map((v) => median(v.slice(a0, Math.max(a0 + ww, Math.round((a0 + e0) / 2)) + 1)));
    const r = motionEdge(ref, addrWin, topI, 1);
    takeX = r.x;
    addrConfBase = r.ok ? 0.9 : 0.6;
  }

  // ---- 5. final impact
  let impX = impY;
  let impMethod = 'hands-lowest';
  if ((IMPACT_HANDS_RETURN || shot.motion === 'stroke') && hAddr && ctx.view === 'face_on') {
    const r = F(0.1);
    let bestX: number | undefined;
    if (shot.motion === 'stroke') {
      // putt: first time the (smoothed) hands pass their address position after the top
      for (let i = Math.round(topX); i < Math.min(n - 1, Math.round(topX) + F(0.8)); i++) {
        if (sx[i] - hAddr.x < 0 && sx[i + 1] - hAddr.x >= 0) {
          bestX = crossAt(sx, i, hAddr.x);
          break;
        }
      }
    }
    for (let i = Math.max(0, Math.floor(impY) - r); bestX === undefined && i < Math.min(n - 1, Math.ceil(impY) + r); i++) {
      if (fx[i] - hAddr.x < 0 && fx[i + 1] - hAddr.x >= 0) {
        const x = crossAt(fx, i, hAddr.x);
        if (bestX === undefined || Math.abs(x - impY) < Math.abs(bestX - impY)) bestX = x;
      }
    }
    if (bestX !== undefined) {
      impX = bestX;
      impMethod = 'hands-return';
    }
  }

  // ---- 6. finish: first still window after impact, far from the impact position
  const impI = Math.round(impX);
  let finX: number | undefined;
  let finConfBase = 0;
  const finWin = findStill(Math.min(n - 1, impI + F(0.05)), n - ww, 1, hImp, 0.3 * ampTop);
  if (finWin) {
    const ref = pS.map((v) => median(v.slice(Math.min(finWin[1] - ww, Math.round((finWin[0] + finWin[1]) / 2)), finWin[1] + 1)));
    const r = motionEdge(ref, finWin, impI, -1);
    finX = r.x;
    finConfBase = r.ok ? 0.85 : 0.6;
  } else {
    // no hold in the finish (clip ends / player walks off): slowest moment of the follow-through
    const lo = impI + F(0.15);
    const hi = Math.min(n - 1, impI + F(1.5));
    if (hi > lo + 2) {
      const i = argExt(speed, lo, hi, false);
      if (speed[i] < 0.2 * peakSpeed && i < n - 1) {
        finX = i;
        finConfBase = 0.4;
      }
    }
  }

  // ---- 7. 9 o'clock positions
  const out: PhaseKeyframe[] = [];
  const push = (position: KeyPosition, x: number, confidence: number, method: string, frameX = x) => {
    const frameIndex = Math.max(0, Math.min(n - 1, Math.round(frameX)));
    out.push({ position, frameIndex, t: frames[frameIndex].t, confidence: Math.round(confidence * 100) / 100, method, tEvent: tAt(x) });
  };
  const wants = new Set(shot.positions);
  if (takeX !== undefined && wants.has('address')) {
    const ai = Math.max(0, Math.round(takeX) - 1);
    push('address', takeX, conf(addrConfBase, ai), 'hands-still', ai);
  }
  const nine = shot.motion === 'full' || shot.motion === 'half' ? NINE_OCLOCK_PROXY[shot.motion] : null;
  if (nine && topOk) {
    const yRef = hAddr ? hAddr.y : hImp.y;
    const rise = (i: number) => (yRef - sy[i]) / (yRef - hTop.y || 1e-9);
    const clubDy = clubVertical(club, n);
    // backswing
    if (wants.has('backswing9')) {
      const lo = takeX !== undefined ? Math.floor(takeX) : Math.max(0, topI - F(1.5));
      let cx: number | undefined;
      let cc = 0;
      for (let i = topI - 1; i >= lo; i--) {
        if (clubDy.v[i] > 0 && clubDy.v[i + 1] <= 0) {
          cx = crossAt(clubDy.v, i);
          cc = Math.min(clubDy.c[i], clubDy.c[i + 1]);
          break;
        }
      }
      let px: number | undefined;
      for (let i = topI - 1; i >= lo; i--) {
        if (rise(i) < nine.back && rise(i + 1) >= nine.back) {
          px = crossAtFn(rise, i, nine.back);
          break;
        }
      }
      if (cx !== undefined) push('backswing9', cx, conf(0.85 * cc, cx), 'club-parallel');
      else if (px !== undefined) push('backswing9', px, conf(0.45, px), 'hands-proxy');
    }
    if (wants.has('downswing9')) {
      const hi = Math.floor(impX);
      let cx: number | undefined;
      let cc = 0;
      for (let i = topI; i < hi; i++) {
        if (clubDy.v[i] <= 0 && clubDy.v[i + 1] > 0) {
          cx = crossAt(clubDy.v, i);
          cc = Math.min(clubDy.c[i], clubDy.c[i + 1]);
          break;
        }
      }
      let px: number | undefined;
      for (let i = topI; i < hi; i++) {
        if (rise(i) > nine.down && rise(i + 1) <= nine.down) {
          px = crossAtFn(rise, i, nine.down);
          break;
        }
      }
      if (cx !== undefined) push('downswing9', cx, conf(0.85 * cc, cx), 'club-parallel');
      else if (px !== undefined) push('downswing9', px, conf(0.45, px), 'hands-proxy');
    }
  }
  if (topOk && wants.has('top')) push('top', topX, conf(addrWin ? 0.9 : 0.75, topX), 'hands-reversal');
  if (wants.has('impact')) push('impact', impX, conf(impMethod === 'hands-return' ? 0.9 : 0.8, impX), impMethod);
  if (finX !== undefined && wants.has('finish')) push('finish', finX, conf(finConfBase, finX), finWin ? 'hands-settled' : 'slowest-follow');

  // keep swing order; drop anything inconsistent
  const order: KeyPosition[] = ['address', 'backswing9', 'top', 'downswing9', 'impact', 'finish'];
  out.sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position));
  const keyframes: PhaseKeyframe[] = [];
  for (const k of out) {
    const prev = keyframes[keyframes.length - 1];
    if (prev && k.frameIndex < prev.frameIndex) continue;
    keyframes.push(k);
  }
  const timing: PhaseTiming = {};
  for (const k of keyframes) {
    if (k.position === 'address') {
      timing.takeawayT = k.tEvent;
      timing.addressT = k.t;
    } else timing[`${k.position}T` as keyof PhaseTiming] = k.tEvent;
  }
  return { keyframes, timing, torso: T };
}

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

function crossAtFn(f: (i: number) => number, i: number, level: number): number {
  const a = f(i) - level;
  const b = f(i + 1) - level;
  return a === b ? i + 0.5 : i + Math.max(0, Math.min(1, a / (a - b)));
}

/**
 * Vertical shaft component per frame: head.y − grip.y (normalized; > 0 = club head below the hands), only for club
 * estimates with confidence ≥ 0.5; short gaps (≤ 3 frames) are bridged, longer gaps stay NaN.
 * Works in both views: a level camera sees "shaft parallel to the ground" as grip and head at the same image height.
 */
function clubVertical(club: (ClubEstimate | null)[], n: number): { v: number[]; c: number[] } {
  const v: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = club[i];
    const ok = k && k.confidence >= 0.5 && k.source !== 'hands';
    v.push(ok ? k!.head.y - k!.grip.y : NaN);
    c.push(ok ? k!.confidence : 0);
  }
  // bridge short gaps only
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(v[i])) continue;
    if (last >= 0 && i - last > 1 && i - last <= 4) {
      for (let j = last + 1; j < i; j++) {
        v[j] = v[last] + ((v[i] - v[last]) * (j - last)) / (i - last);
        c[j] = Math.min(c[last], c[i]) * 0.9;
      }
    }
    last = i;
  }
  return { v, c };
}
