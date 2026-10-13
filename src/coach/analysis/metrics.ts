import { LM } from '../model/constants';
import { angleDiff, angleOf, aspectOf, clamp, deg, jointAngle, mid } from '../model/geometry';
import type {
  ClubEstimate,
  KeyPosition,
  Landmark,
  Line2,
  MetricId,
  MetricUnit,
  MetricValue,
  PhaseKeyframe,
  PoseSequence,
  SwingMetrics,
  Vec2,
} from '../model/types';
import { metricAvailable } from '../faults/metricContract';
import type { AnalysisContext } from './context';
import { detectKeyframes } from './phases';
import { fillGaps, gaussSmooth, torsoLength } from './signals';

/**
 * OWNER: agent "phases-metrics" (work package C3).
 * Metrics per docs/coach/02_METRICS.md (availability per view/shot from faults/metricContract.ts, the machine-readable
 * copy of that table). All 2D, canonical right-handed frame, pixel space (x × aspect). Definitions, signs and the 2D→3D
 * mapping of the turn proxies: docs/coach/decisions/phases-metrics.md. Every value carries a confidence:
 *   visibility of the points × suitability of the view × key-frame confidence × club source (hand-estimated club ≤ 0.4).
 */

export const METRIC_UNITS: Record<MetricId, MetricUnit> = {
  shoulder_turn: 'deg', hip_turn: 'deg', x_factor: 'deg', spine_angle: 'deg', spine_angle_change: 'deg',
  side_bend: 'deg', head_shift_x: 'pct_torso', head_shift_y: 'pct_torso', hip_shift_x: 'pct_torso',
  hip_depth_change: 'pct_torso', lead_arm_angle: 'deg', trail_arm_angle: 'deg', lead_wrist_hinge: 'deg',
  hand_height: 'pct_torso', hand_depth: 'pct_torso', hands_ahead: 'pct_torso', shaft_plane_dev: 'deg',
  shaft_lean: 'deg', knee_flex: 'deg', stance_width: 'ratio', tempo_ratio: 'ratio', backswing_ms: 'ms',
  downswing_ms: 'ms', putter_wrist_change: 'deg', body_motion: 'pct_torso', swing_length: 'deg',
  lead_arm_post_impact: 'deg', hand_path_shift: 'pct_torso',
};

/** 2D proxies need a body width that is invisible from behind; defaults relative to the torso length. REVIEW(calibration) */
export const DTL_WIDTH_RATIO = { shoulder: 0.75, hip: 0.55 };

/** How suitable a view is for a metric (multiplies the confidence). Anything not listed = 1. */
const VIEW_FACTOR: Partial<Record<MetricId, { face_on?: number; down_the_line?: number }>> = {
  swing_length: { down_the_line: 0.7 },
  shoulder_turn: { face_on: 0.8, down_the_line: 0.7 },
  hip_turn: { face_on: 0.7, down_the_line: 0.6 },
  x_factor: { face_on: 0.7, down_the_line: 0.6 },
  lead_arm_angle: { down_the_line: 0.8 },
  body_motion: { down_the_line: 0.6 },
  putter_wrist_change: { down_the_line: 0.5 },
  // from behind forearm and shaft are both foreshortened around 9 o'clock – the 2D angle is unreliable (casting test)
  lead_wrist_hinge: { down_the_line: 0.5 },
};

// ------------------------------------------------------------------ small pure helpers (exported)

export { handCentre, torsoLength, torsoLengthOf, shoulderCentre, hipCentre } from './signals';

/** Visibility → confidence factor (0.3 → 0, ≥ 0.8 → 1). */
export function visFactor(v: number): number {
  return clamp((v - 0.3) / 0.5, 0, 1);
}

/** Average landmarks over frames [a, b] (only frames with a pose). Null when none. */
export function averageLandmarks(seq: PoseSequence, a: number, b: number): Landmark[] | null {
  const n = seq.frames.length;
  let cnt = 0;
  let acc: Landmark[] | null = null;
  for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) {
    const lm = seq.frames[i].lm;
    if (!lm) continue;
    if (!acc) acc = lm.map(() => ({ x: 0, y: 0, z: 0, v: 0 }));
    for (let k = 0; k < lm.length; k++) {
      acc[k].x += lm[k].x;
      acc[k].y += lm[k].y;
      acc[k].z += lm[k].z;
      acc[k].v += lm[k].v;
    }
    cnt++;
  }
  if (!acc || !cnt) return null;
  return acc.map((p) => ({ x: p.x / cnt, y: p.y / cnt, z: p.z / cnt, v: p.v / cnt }));
}

/** Landmarks around one frame: ±radius frames, widened up to 3 more frames when the pose is missing there. */
export function sampleFrame(seq: PoseSequence, i: number, radius: number): { lm: Landmark[]; widened: boolean } | null {
  for (let r = radius; r <= radius + 3; r++) {
    const lm = averageLandmarks(seq, i - r, i + r);
    if (lm) return { lm, widened: r > radius };
  }
  return null;
}

/** Fractional frame position of a time (ms). */
export function frameAt(seq: PoseSequence, tMs: number): number {
  const f = seq.frames;
  let lo = 0;
  let hi = f.length - 1;
  if (tMs <= f[0].t) return 0;
  if (tMs >= f[hi].t) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (f[m].t <= tMs) lo = m;
    else hi = m;
  }
  return lo + (tMs - f[lo].t) / (f[hi].t - f[lo].t || 1);
}

/** Landmarks linearly interpolated at a fractional frame (null when a neighbour has no pose). */
export function interpLandmarks(seq: PoseSequence, x: number): Landmark[] | null {
  const i = Math.floor(x);
  const a = seq.frames[i]?.lm;
  const b = seq.frames[Math.min(seq.frames.length - 1, i + 1)]?.lm;
  if (!a || !b) return null;
  const w = x - i;
  return a.map((p, k) => ({ x: p.x + (b[k].x - p.x) * w, y: p.y + (b[k].y - p.y) * w, z: p.z + (b[k].z - p.z) * w, v: Math.min(p.v, b[k].v) }));
}

function interpClub(club: (ClubEstimate | null)[], x: number): ClubEstimate | null {
  const i = Math.floor(x);
  const a = club[i];
  const b = club[i + 1];
  if (!a || !b) return null;
  const w = x - i;
  const L = (p: Vec2, q: Vec2) => ({ x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w });
  return { ...a, grip: L(a.grip, b.grip), head: L(a.head, b.head), angleDeg: a.angleDeg + angleDiff(b.angleDeg, a.angleDeg) * w, confidence: Math.min(a.confidence, b.confidence) };
}

function nearestClub(club: (ClubEstimate | null)[], i: number): ClubEstimate | null {
  for (const d of [0, -1, 1, -2, 2]) {
    const c = club[i + d];
    if (c) return c;
  }
  return null;
}

/** Club confidence factor: hand-estimated club ≤ 0.4 (contract), otherwise its own confidence. */
function clubFactor(c: ClubEstimate): number {
  return c.source === 'hands' ? Math.min(0.4, c.confidence) : clamp(c.confidence, 0, 1);
}

// ------------------------------------------------------------------ reference (address) data

/** Everything a position metric needs besides the frame itself. */
export interface MetricRef {
  aspect: number;
  /** address landmarks (averaged over the still frames) or null when the clip has no address */
  A: Landmark[] | null;
  /** torso length in pixel space (address, else clip median) */
  T: number;
  addressClub: ClubEstimate | null;
  /** projected shaft length used to turn the plane offset into an angle */
  shaftLen: number;
  /** body widths seen from behind (pixel space) */
  dtlShoulderW: number;
  dtlHipW: number;
  neutral: Line2 | null;
}

const P = (lm: Landmark[], i: number, aspect: number): Vec2 => ({ x: lm[i].x * aspect, y: lm[i].y });
const vOf = (lm: Landmark[], ...idx: number[]) => Math.min(...idx.map((i) => lm[i]?.v ?? 0));
const pts = {
  sh: (lm: Landmark[], a: number) => mid(P(lm, LM.LEFT_SHOULDER, a), P(lm, LM.RIGHT_SHOULDER, a)),
  hip: (lm: Landmark[], a: number) => mid(P(lm, LM.LEFT_HIP, a), P(lm, LM.RIGHT_HIP, a)),
  hands: (lm: Landmark[], a: number) => mid(P(lm, LM.LEFT_WRIST, a), P(lm, LM.RIGHT_WRIST, a)),
};

/** Head point = mean of nose and both ears (those reasonably visible). */
function head(lm: Landmark[], aspect: number): { p: Vec2; v: number } {
  const idx = [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR].filter((i) => lm[i] && lm[i].v >= 0.3);
  const use = idx.length ? idx : [LM.NOSE];
  const p = use.reduce((s, i) => ({ x: s.x + lm[i].x * aspect, y: s.y + lm[i].y }), { x: 0, y: 0 });
  return { p: { x: p.x / use.length, y: p.y / use.length }, v: Math.max(...use.map((i) => lm[i]?.v ?? 0)) };
}

function buildRef(
  seq: PoseSequence,
  addressIndex: number | undefined,
  club: (ClubEstimate | null)[],
  neutral: Line2 | null,
  wholeClip: boolean,
): MetricRef {
  const aspect = aspectOf(seq);
  const fps = seq.fps || 30;
  let A: Landmark[] | null = null;
  if (addressIndex !== undefined) A = averageLandmarks(seq, addressIndex - Math.round(0.1 * fps), addressIndex);
  let T = NaN;
  if (A) {
    const s = pts.sh(A, aspect);
    const h = pts.hip(A, aspect);
    T = Math.hypot(s.x - h.x, s.y - h.y);
  }
  if (!(T > 0)) T = torsoLength(seq);
  const addressClub = addressIndex !== undefined ? nearestClub(club, addressIndex) : null;
  const lens: number[] = [];
  let shW = DTL_WIDTH_RATIO.shoulder * T;
  let hipW = DTL_WIDTH_RATIO.hip * T;
  if (wholeClip) {
    // seen from behind the full width shows when the body faces the camera side-on (top / finish of a full swing)
    const sw: number[] = [];
    const hw: number[] = [];
    for (const f of seq.frames) {
      if (!f.lm) continue;
      const ls = P(f.lm, LM.LEFT_SHOULDER, aspect);
      const rs = P(f.lm, LM.RIGHT_SHOULDER, aspect);
      const lh = P(f.lm, LM.LEFT_HIP, aspect);
      const rh = P(f.lm, LM.RIGHT_HIP, aspect);
      sw.push(Math.hypot(ls.x - rs.x, ls.y - rs.y));
      hw.push(Math.hypot(lh.x - rh.x, lh.y - rh.y));
    }
    shW = Math.max(shW, quantile(sw, 0.95));
    hipW = Math.max(hipW, quantile(hw, 0.95));
    for (const c of club) if (c && c.source !== 'hands') lens.push(Math.hypot((c.head.x - c.grip.x) * aspect, c.head.y - c.grip.y));
  }
  const addrLen = addressClub ? Math.hypot((addressClub.head.x - addressClub.grip.x) * aspect, addressClub.head.y - addressClub.grip.y) : NaN;
  const shaftLen = Math.max(Number.isFinite(addrLen) ? addrLen : 0, lens.length ? quantile(lens, 0.9) : 0) || NaN;
  return { aspect, A, T, addressClub, shaftLen, dtlShoulderW: shW, dtlHipW: hipW, neutral };
}

function quantile(v: number[], q: number): number {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
}

// ------------------------------------------------------------------ per-position metrics

interface Raw {
  value: number;
  /** min visibility of the points involved */
  v: number;
  /** extra factor (club source, proxy …) */
  f?: number;
}

/** Turn proxy (deg) of a body line (lead point a, trail point b) relative to address. See decisions doc. */
function turnProxy(
  F: Landmark[],
  A: Landmark[],
  ia: number,
  ib: number,
  view: AnalysisContext['view'],
  aspect: number,
  dtlWidth: number,
  fallbackSign: number,
  signFromDepth: boolean,
): number {
  const a = P(F, ia, aspect);
  const b = P(F, ib, aspect);
  const a0 = P(A, ia, aspect);
  const b0 = P(A, ib, aspect);
  if (view === 'face_on') {
    // face-on the line shortens like cos(turn) (lead point is image-right at address)
    const r = (a.x - b.x) / (a0.x - b0.x || 1e-9);
    const mag = deg(Math.acos(clamp(r, -1, 1)));
    let sign = fallbackSign;
    if (signFromDepth) {
      const dz = F[ib].z - F[ia].z - (A[ib].z - A[ia].z);
      if (Math.abs(dz) > 0.1 * Math.abs(A[ia].x - A[ib].x)) sign = dz > 0 ? 1 : -1;
    } else {
      // shoulders: the lead shoulder drops in the backswing turn and rises when turning through
      const dy = a.y - b.y - (a0.y - b0.y);
      if (Math.abs(dy) > 0.02 * Math.abs(a0.x - b0.x)) sign = dy > 0 ? 1 : -1;
    }
    return sign * mag;
  }
  // down-the-line the line is seen end-on at address and grows like sin(turn); + = lead point towards the ball (+x)
  const ang = (p: Vec2, q: Vec2) => {
    const l = Math.hypot(p.x - q.x, p.y - q.y);
    return Math.sign(p.x - q.x || 1) * deg(Math.asin(clamp(l / dtlWidth, 0, 1)));
  };
  return ang(a, b) - ang(a0, b0);
}

/** Hand arc angle around the shoulder centre vs. address (deg, + = backswing). */
function armArc(F: Landmark[], A: Landmark[], view: AnalysisContext['view'], aspect: number): number {
  const s = pts.sh(F, aspect);
  const h = pts.hands(F, aspect);
  const s0 = pts.sh(A, aspect);
  const h0 = pts.hands(A, aspect);
  if (view === 'face_on') return angleDiff(angleOf(s, h), angleOf(s0, h0));
  // from behind the arc is seen edge-on: use the projection on the address direction (cos of the arc)
  const d0 = { x: h0.x - s0.x, y: h0.y - s0.y };
  const l0 = Math.hypot(d0.x, d0.y) || 1e-9;
  const proj = ((h.x - s.x) * d0.x + (h.y - s.y) * d0.y) / (l0 * l0);
  return deg(Math.acos(clamp(proj, -1, 1)));
}

function forearmShaftAngle(F: Landmark[], c: ClubEstimate, aspect: number): number {
  const e = P(F, LM.LEFT_ELBOW, aspect);
  const w = P(F, LM.LEFT_WRIST, aspect);
  const u = { x: w.x - e.x, y: w.y - e.y };
  const s = { x: (c.head.x - c.grip.x) * aspect, y: c.head.y - c.grip.y };
  const n = Math.hypot(u.x, u.y) * Math.hypot(s.x, s.y);
  return n ? deg(Math.acos(clamp((u.x * s.x + u.y * s.y) / n, -1, 1))) : NaN;
}

/** Forearm vs. hand (wrist → between index and pinky) – the club-less wrist angle used for the putt. */
function forearmHandAngle(F: Landmark[], aspect: number): number {
  const e = P(F, LM.LEFT_ELBOW, aspect);
  const w = P(F, LM.LEFT_WRIST, aspect);
  const h = mid(P(F, LM.LEFT_INDEX, aspect), P(F, LM.LEFT_PINKY, aspect));
  return 180 - jointAngle(e, w, h);
}

function rawAt(id: MetricId, at: KeyPosition, F: Landmark[], ref: MetricRef, c: ClubEstimate | null, ctx: AnalysisContext): Raw | null {
  const a = ref.aspect;
  const A = ref.A;
  const T = ref.T;
  const pct = (d: number) => (100 * d) / T;
  const L = LM;
  switch (id) {
    case 'head_shift_x':
    case 'head_shift_y': {
      if (!A) return null;
      const h = head(F, a);
      const h0 = head(A, a);
      return id === 'head_shift_x' ? { value: pct(h.p.x - h0.p.x), v: Math.min(h.v, h0.v) } : { value: pct(h0.p.y - h.p.y), v: Math.min(h.v, h0.v) };
    }
    case 'hip_shift_x':
    case 'hip_depth_change': {
      if (!A) return null;
      return { value: pct(pts.hip(F, a).x - pts.hip(A, a).x), v: vOf(F, L.LEFT_HIP, L.RIGHT_HIP) };
    }
    case 'hand_depth': {
      if (!A) return null;
      return { value: pct(pts.hands(F, a).x - pts.hands(A, a).x), v: vOf(F, L.LEFT_WRIST, L.RIGHT_WRIST) };
    }
    case 'side_bend': {
      const s = pts.sh(F, a);
      const h = pts.hip(F, a);
      return { value: deg(Math.atan2(h.x - s.x, h.y - s.y)), v: vOf(F, L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP) };
    }
    case 'spine_angle':
    case 'spine_angle_change': {
      const sp = (lm: Landmark[]) => {
        const s = pts.sh(lm, a);
        const h = pts.hip(lm, a);
        return deg(Math.atan2(s.x - h.x, h.y - s.y));
      };
      const v = vOf(F, L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP);
      if (id === 'spine_angle') return { value: sp(F), v };
      return A ? { value: sp(F) - sp(A), v } : null;
    }
    case 'shoulder_turn':
    case 'hip_turn':
    case 'x_factor': {
      if (!A) return null;
      const sign = at === 'top' || at === 'backswing9' ? 1 : -1;
      const sh = turnProxy(F, A, L.LEFT_SHOULDER, L.RIGHT_SHOULDER, ctx.view, a, ref.dtlShoulderW, sign, false);
      const hp = turnProxy(F, A, L.LEFT_HIP, L.RIGHT_HIP, ctx.view, a, ref.dtlHipW, sign, true);
      const vs = vOf(F, L.LEFT_SHOULDER, L.RIGHT_SHOULDER);
      const vh = vOf(F, L.LEFT_HIP, L.RIGHT_HIP);
      if (id === 'shoulder_turn') return { value: sh, v: vs };
      if (id === 'hip_turn') return { value: hp, v: vh };
      return { value: sh - hp, v: Math.min(vs, vh) };
    }
    case 'swing_length': {
      if (!A) return null;
      return { value: armArc(F, A, ctx.view, a), v: vOf(F, L.LEFT_WRIST, L.RIGHT_WRIST, L.LEFT_SHOULDER, L.RIGHT_SHOULDER) };
    }
    case 'lead_arm_angle':
      return { value: jointAngle(P(F, L.LEFT_SHOULDER, a), P(F, L.LEFT_ELBOW, a), P(F, L.LEFT_WRIST, a)), v: vOf(F, L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST) };
    case 'trail_arm_angle':
      return { value: jointAngle(P(F, L.RIGHT_SHOULDER, a), P(F, L.RIGHT_ELBOW, a), P(F, L.RIGHT_WRIST, a)), v: vOf(F, L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST) };
    case 'knee_flex':
      return { value: 180 - jointAngle(P(F, L.RIGHT_HIP, a), P(F, L.RIGHT_KNEE, a), P(F, L.RIGHT_ANKLE, a)), v: vOf(F, L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE) };
    case 'stance_width': {
      const ank = Math.abs(P(F, L.LEFT_ANKLE, a).x - P(F, L.RIGHT_ANKLE, a).x);
      const sh = Math.abs(P(F, L.LEFT_SHOULDER, a).x - P(F, L.RIGHT_SHOULDER, a).x);
      return sh > 0 ? { value: ank / sh, v: vOf(F, L.LEFT_ANKLE, L.RIGHT_ANKLE, L.LEFT_SHOULDER, L.RIGHT_SHOULDER) } : null;
    }
    case 'lead_wrist_hinge': {
      if (!c) return null;
      return { value: forearmShaftAngle(F, c, a), v: vOf(F, L.LEFT_ELBOW, L.LEFT_WRIST), f: c.source === 'hands' ? Math.min(0.3, c.confidence) : clubFactor(c) };
    }
    case 'shaft_lean': {
      if (!c) return null;
      return { value: deg(Math.atan2((c.grip.x - c.head.x) * a, c.head.y - c.grip.y)), v: 1, f: clubFactor(c) };
    }
    case 'hands_ahead': {
      const h = pts.hands(F, a);
      const v = vOf(F, L.LEFT_WRIST, L.RIGHT_WRIST);
      if (c && c.source !== 'hands') return { value: pct(h.x - c.head.x * a), v, f: clubFactor(c) };
      // without the club: hands vs. their address position (proxy, never trusted for a diagnosis)
      return A ? { value: pct(h.x - pts.hands(A, a).x), v, f: 0.3 } : null;
    }
    case 'shaft_plane_dev': {
      if (!c || c.source === 'hands') return null;
      const nl = ref.neutral ?? (ref.addressClub ? { a: ref.addressClub.grip, b: ref.addressClub.head } : null);
      if (!nl || !(ref.shaftLen > 0)) return null;
      let d = { x: (nl.b.x - nl.a.x) * a, y: nl.b.y - nl.a.y };
      if (d.y < 0) d = { x: -d.x, y: -d.y };
      const dl = Math.hypot(d.x, d.y) || 1e-9;
      const nrm = { x: d.y / dl, y: -d.x / dl }; // normal pointing to the image-right side of the line (= steep)
      const off = (c.head.x - c.grip.x) * a * nrm.x + (c.head.y - c.grip.y) * nrm.y;
      return { value: deg(Math.asin(clamp(off / ref.shaftLen, -1, 1))), v: 1, f: clubFactor(c) };
    }
    default:
      return null;
  }
}

/** Position metric ids in a stable order (swing-level ids are computed separately). */
const POSITION_IDS: MetricId[] = [
  'stance_width', 'knee_flex', 'spine_angle', 'side_bend', 'swing_length', 'shoulder_turn', 'hip_turn', 'x_factor',
  'lead_arm_angle', 'trail_arm_angle', 'lead_wrist_hinge', 'head_shift_x', 'head_shift_y', 'hip_shift_x',
  'spine_angle_change', 'hip_depth_change', 'hand_depth', 'hands_ahead', 'shaft_lean', 'shaft_plane_dev',
];

function positionMetrics(
  F: Landmark[],
  at: KeyPosition,
  ref: MetricRef,
  c: ClubEstimate | null,
  ctx: AnalysisContext,
  kfFactor: number,
): MetricValue[] {
  const out: MetricValue[] = [];
  for (const id of POSITION_IDS) {
    if (!metricAvailable(id, at, ctx.view, ctx.shotType)) continue;
    const r = rawAt(id, at, F, ref, c, ctx);
    if (!r || !Number.isFinite(r.value)) continue;
    const vf = VIEW_FACTOR[id]?.[ctx.view] ?? 1;
    const conf = visFactor(r.v) * vf * kfFactor * (r.f ?? 1);
    out.push({ id, at, value: round(r.value), unit: METRIC_UNITS[id], confidence: round(clamp(conf, 0, 1)) });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ public API

/**
 * OWNER: agent "phases-metrics" (work package C).
 * Compute all metrics that make sense for ctx.view / ctx.shotType at the detected key positions.
 */
export function computeMetrics(
  seq: PoseSequence,
  club: (ClubEstimate | null)[],
  keyframes: PhaseKeyframe[],
  neutralLine: Line2 | null,
  ctx: AnalysisContext,
): SwingMetrics {
  const n = seq.frames.length;
  if (!n) return { values: [] };
  // no key positions given (e.g. a caller that only has the pose): detect them here
  if (!keyframes.length) keyframes = detectKeyframes(seq, club, ctx);
  if (!keyframes.length) return { values: [] };
  const fps = seq.fps || 30;
  const kf = (p: KeyPosition) => keyframes.find((k) => k.position === p);
  const addr = kf('address');
  const ref = buildRef(seq, addr?.frameIndex, club, neutralLine, true);
  if (!(ref.T > 0)) return { values: [] };
  const radius = Math.floor(0.02 * fps);
  const values: MetricValue[] = [];
  const kfFactor = (k: PhaseKeyframe) => 0.7 + 0.3 * clamp(k.confidence, 0, 1);

  for (const k of keyframes) {
    const s = sampleFrame(seq, k.frameIndex, k.position === 'address' ? 0 : radius);
    if (!s) continue;
    let F = k.position === 'address' && ref.A ? ref.A : s.lm;
    let c = nearestClub(club, k.frameIndex);
    // the club turns ~20° per frame around impact at 60 fps: use the exact (sub-frame) event time there
    if (k.tEvent !== undefined && k.position !== 'address') {
      const x = frameAt(seq, k.tEvent);
      c = interpClub(club, x) ?? c;
      if (k.position === 'impact') F = interpLandmarks(seq, x) ?? F;
    }
    // Down-the-line at 9 o'clock the shaft points almost into the camera and is too short in the picture for a few
    // frames. The plane offset hardly changes within ±50 ms (the shaft turns IN its plane), so use the nearest frame
    // where the shaft was found in the image, with a little less confidence (lead decision L5).
    if ((!c || c.source === 'hands') && (k.position === 'backswing9' || k.position === 'downswing9' || k.position === 'top')) {
      const win = Math.max(1, Math.round(0.05 * fps));
      for (let d = 1; d <= win; d++) {
        const near = [club[k.frameIndex - d], club[k.frameIndex + d]].find((x) => x && x.source !== 'hands' && x.confidence >= 0.45);
        if (near) {
          c = { ...near, confidence: near.confidence * (1 - 0.05 * d) };
          break;
        }
      }
    }
    values.push(...positionMetrics(F, k.position, ref, c, ctx, kfFactor(k) * (s.widened ? 0.8 : 1)));
  }

  const has = (id: MetricId) => metricAvailable(id, 'swing', ctx.view, ctx.shotType);
  const push = (id: MetricId, at: KeyPosition | 'swing', value: number, conf: number) => {
    if (Number.isFinite(value)) values.push({ id, at, value: round(value), unit: METRIC_UNITS[id], confidence: round(clamp(conf, 0, 1)) });
  };

  // ---- timing
  const top = kf('top');
  const imp = kf('impact');
  const fpsF = fps < 25 ? 0.5 : fps < 50 ? 0.85 : 1;
  const tOf = (k: PhaseKeyframe) => k.tEvent ?? (k.position === 'address' ? seq.frames[Math.min(n - 1, k.frameIndex + 1)].t : k.t);
  if (top && imp) {
    const ds = tOf(imp) - tOf(top);
    if (ds > 0) {
      if (has('downswing_ms')) push('downswing_ms', 'swing', ds, Math.min(top.confidence, imp.confidence) * fpsF);
      if (addr) {
        const bs = tOf(top) - tOf(addr);
        const c = Math.min(addr.confidence, top.confidence, imp.confidence) * fpsF;
        if (bs > 0 && has('backswing_ms')) push('backswing_ms', 'swing', bs, c);
        if (bs > 0 && has('tempo_ratio')) push('tempo_ratio', 'swing', bs / ds, c);
      }
    }
  }

  // ---- hand path (DTL, over the top)
  const b9 = values.find((v) => v.id === 'hand_depth' && v.at === 'backswing9');
  const d9 = values.find((v) => v.id === 'hand_depth' && v.at === 'downswing9');
  if (b9 && d9 && metricAvailable('hand_path_shift', 'downswing9', ctx.view, ctx.shotType))
    push('hand_path_shift', 'downswing9', d9.value - b9.value, Math.min(b9.confidence, d9.confidence));

  // ---- lead arm after impact (chicken wing): at "3 o'clock" (hands 90° through), else 0.12 s after impact
  const fin = kf('finish');
  if (imp && ref.A && has('lead_arm_post_impact')) {
    let at = -1;
    const end = fin ? fin.frameIndex : Math.min(n - 1, imp.frameIndex + Math.round(0.6 * fps));
    for (let i = imp.frameIndex; i <= end; i++) {
      const lm = seq.frames[i].lm;
      if (lm && armArc(lm, ref.A, ctx.view, ref.aspect) <= -90) {
        at = i;
        break;
      }
    }
    const method = at >= 0 ? 1 : 0.8;
    if (at < 0) at = Math.min(n - 1, imp.frameIndex + Math.round(0.12 * fps));
    const s = sampleFrame(seq, at, Math.max(1, radius));
    if (s) {
      const r = rawAt('lead_arm_angle', 'impact', s.lm, ref, null, ctx)!;
      push('lead_arm_post_impact', 'swing', r.value, visFactor(r.v) * kfFactor(imp) * method);
    }
  }

  // ---- stroke metrics (putt / chip): body motion and wrist change over the stroke
  if (addr && ref.A && (has('body_motion') || has('putter_wrist_change'))) {
    const a0 = addr.frameIndex;
    const a1 = fin ? fin.frameIndex : imp ? Math.min(n - 1, imp.frameIndex + Math.round(0.3 * fps)) : -1;
    if (a1 > a0) {
      const sig = 0.04 * fps;
      const conf0 = Math.min(addr.confidence, imp?.confidence ?? 0.5, fin?.confidence ?? 0.5);
      if (has('body_motion')) {
        const s0 = pts.sh(ref.A, ref.aspect);
        const dx: number[] = [];
        const dy: number[] = [];
        let vis = 0;
        let cnt = 0;
        for (let i = 0; i < n; i++) {
          const lm = seq.frames[i].lm;
          const ok = lm && Math.min(lm[LM.LEFT_SHOULDER].v, lm[LM.RIGHT_SHOULDER].v) >= 0.3;
          const s = ok ? pts.sh(lm!, ref.aspect) : null;
          dx.push(s ? s.x - s0.x : NaN);
          dy.push(s ? s.y - s0.y : NaN);
          if (ok && i >= a0 && i <= a1) {
            vis += Math.min(lm![LM.LEFT_SHOULDER].v, lm![LM.RIGHT_SHOULDER].v);
            cnt++;
          }
        }
        const sx = gaussSmooth(fillGaps(dx), sig);
        const sy = gaussSmooth(fillGaps(dy), sig);
        let m = 0;
        for (let i = a0; i <= a1; i++) m = Math.max(m, Math.hypot(sx[i], sy[i]));
        const vf = VIEW_FACTOR.body_motion?.[ctx.view] ?? 1;
        if (cnt) push('body_motion', 'swing', (100 * m) / ref.T, visFactor(vis / cnt) * vf * (0.7 + 0.3 * conf0));
      }
      if (has('putter_wrist_change')) {
        const useClub = club.slice(a0, a1 + 1).filter((c) => c && c.source !== 'hands' && c.confidence >= 0.5).length > 0.8 * (a1 - a0 + 1);
        const ang: number[] = [];
        let cf = 0;
        let cc = 0;
        for (let i = 0; i < n; i++) {
          const lm = seq.frames[i].lm;
          const c = club[i];
          if (!lm || i < a0 - 3 || i > a1 + 3) {
            ang.push(NaN);
            continue;
          }
          const v = useClub && c ? forearmShaftAngle(lm, c, ref.aspect) : useClub ? NaN : forearmHandAngle(lm, ref.aspect);
          ang.push(v);
          if (c && useClub) {
            cf += clubFactor(c);
            cc++;
          }
        }
        const sm = gaussSmooth(fillGaps(ang), sig);
        const base = sm[a0];
        let m = 0;
        for (let i = a0; i <= a1; i++) if (Math.abs(sm[i] - base) > Math.abs(m)) m = sm[i] - base;
        const vis = vOf(ref.A, LM.LEFT_ELBOW, LM.LEFT_WRIST);
        const src = useClub ? (cc ? cf / cc : 0.5) : 0.4;
        const vf = VIEW_FACTOR.putter_wrist_change?.[ctx.view] ?? 1;
        if (Number.isFinite(base)) push('putter_wrist_change', 'swing', Math.abs(m), visFactor(vis) * src * vf * (0.7 + 0.3 * conf0));
      }
    }
  }
  return { values };
}

/**
 * Metrics of ONE frame against the address frame – used live by the training mode (mirror mode, series).
 * Same definitions/units as computeMetrics. `at` is the position the frame stands for. Cheap: one frame plus the
 * averaged address window; swing-level values (tempo, chicken wing, hand path) are not available here.
 */
export function metricsAtFrame(
  seq: PoseSequence,
  frameIndex: number,
  addressIndex: number,
  at: KeyPosition,
  club: (ClubEstimate | null)[],
  neutralLine: Line2 | null,
  ctx: AnalysisContext,
): MetricValue[] {
  const f = seq.frames[frameIndex];
  if (!f || !f.lm) return [];
  const ref = buildRef(seq, addressIndex, club, neutralLine, false);
  if (!(ref.T > 0)) return [];
  const F = at === 'address' && ref.A ? ref.A : f.lm;
  return positionMetrics(F, at, ref, club[frameIndex] ?? null, ctx, 1);
}

/** Convenience lookup. */
export function getMetric(m: SwingMetrics, id: MetricId, at: KeyPosition | 'swing'): MetricValue | undefined {
  return m.values.find((v) => v.id === id && v.at === at);
}
