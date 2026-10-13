import { LM, SHOT_TYPES } from '../model/constants';
import { aspectOf, dist, median, mid, pt } from '../model/geometry';
import type { AnalysisQuality, ClubEstimate, Landmark, PhaseKeyframe, PoseSequence, QualityIssue, Vec2 } from '../model/types';
import type { AnalysisContext } from './context';

/**
 * OWNER: agent "capture-pose" (work package C / quality rule of brief section 7).
 * Rate how trustworthy the recording is. Below QUALITY_MIN the app shows "not reliably detectable" instead of faults.
 * `extra` is passed after phases and club are known.
 *
 * Input: the smoothed, CANONICAL sequence (right-handed frame). Score = detection × visibility × penalties per issue.
 * Thresholds: docs/coach/decisions/capture-pose.md (CP-2).
 */
export const QUALITY_LIMITS = {
  /** below this share of frames with a person → no_person */
  minDetected: 0.2,
  /** mean visibility of the core joints */
  minVisibility: 0.6,
  /** 29.97 fps phones must not count as "low" */
  minFps: 29,
  /** share of frames in which head, feet or hands are outside the picture */
  maxCutOffShare: 0.15,
  // REVIEW(golf): feet should not move during a swing; 30 % of the torso length allows heel lift and a step in the finish
  maxFootDrift: 0.3,
  /** player (nose to feet, ×1.12 for the top of the head) smaller than this share of the frame height → too far */
  minPlayerHeight: 0.35,
  // REVIEW(golf): face-on, the hands must move clearly away from the target in the backswing (image left, canonical)
  mirroredHandShift: 0.1,
  /** share of frames with a club found in the IMAGE (not estimated from the hands) */
  minClubShare: 0.5,
  /** share of frames with a second person */
  maxMultiPerson: 0.3,
} as const;

const CORE = [
  LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

/** Score multipliers per issue (no_person, no_swing_found and mirrored_suspected cap the score below QUALITY_MIN). */
const PENALTY: Partial<Record<QualityIssue, number>> = {
  body_cut_off: 0.6,
  too_short: 0.5,
  camera_moving: 0.5,
  too_far: 0.7,
  club_not_found: 0.9,
  multiple_people: 0.8,
};
const CAP: Partial<Record<QualityIssue, number>> = { no_person: 0, no_swing_found: 0.3, mirrored_suspected: 0.35 };

export function assessQuality(
  seq: PoseSequence,
  ctx: AnalysisContext,
  extra?: { keyframes?: PhaseKeyframe[]; club?: (ClubEstimate | null)[] },
): AnalysisQuality {
  const n = seq.frames.length;
  const det = seq.frames.map((f, i) => ({ i, lm: f.lm })).filter((f): f is { i: number; lm: Landmark[] } => !!f.lm);
  const detectedFrameRatio = n ? det.length / n : 0;
  const fps = seq.fps > 0 ? seq.fps : estimateFps(seq);
  const issues: QualityIssue[] = [];
  const add = (q: QualityIssue) => {
    if (!issues.includes(q)) issues.push(q);
  };

  let vs = 0;
  let vc = 0;
  for (const f of det) for (const j of CORE) {
    vs += f.lm[j].v;
    vc++;
  }
  const meanVisibility = vc ? vs / vc : 0;

  if (det.length === 0 || detectedFrameRatio < QUALITY_LIMITS.minDetected) {
    add('no_person');
    return finish({ detectedFrameRatio, meanVisibility, fps, issues });
  }
  if (meanVisibility < QUALITY_LIMITS.minVisibility) add('low_visibility');
  if (fps < QUALITY_LIMITS.minFps) add('low_fps');

  const durationMs = n > 1 ? seq.frames[n - 1].t - seq.frames[0].t : 0;
  if (det.length < 8 || durationMs < SHOT_TYPES[ctx.shotType].typicalSwingMs[0] + 300) add('too_short');

  if (cutOffShare(det.map((d) => d.lm)) > QUALITY_LIMITS.maxCutOffShare) add('body_cut_off');

  const aspect = aspectOf(seq);
  const torso = torsoLength(det.map((d) => d.lm), aspect);
  if (Number.isFinite(torso) && torso > 0) {
    if (footDrift(det.map((d) => d.lm), aspect) / torso > QUALITY_LIMITS.maxFootDrift) add('camera_moving');
    if (mirroredSuspected(seq, ctx, torso, extra?.keyframes)) add('mirrored_suspected');
  }
  if (playerHeight(det.map((d) => d.lm)) < QUALITY_LIMITS.minPlayerHeight) add('too_far');

  if (extra?.keyframes) {
    const has = (p: string) => extra.keyframes!.some((k) => k.position === p);
    if (!has('top') || !has('impact')) add('no_swing_found');
  }
  if (extra?.club) {
    const good = det.filter((d) => {
      const c = extra.club![d.i];
      return c && c.source !== 'hands';
    }).length;
    if (good / det.length < QUALITY_LIMITS.minClubShare) add('club_not_found');
  }
  if ((seq.multiPersonRatio ?? 0) > QUALITY_LIMITS.maxMultiPerson) add('multiple_people');

  return finish({ detectedFrameRatio, meanVisibility, fps, issues });
}

function finish(q: Omit<AnalysisQuality, 'score'>): AnalysisQuality {
  // detection: 90 % of frames → full marks, 50 % → 0
  const fDet = clamp01((q.detectedFrameRatio - 0.5) / 0.4);
  const fVis = clamp01((q.meanVisibility - 0.4) / 0.35);
  const fFps = q.fps >= QUALITY_LIMITS.minFps ? 1 : q.fps >= 20 ? 0.85 : 0.6;
  let score = fDet * fVis * fFps;
  for (const i of q.issues) score *= PENALTY[i] ?? 1;
  for (const i of q.issues) if (CAP[i] !== undefined) score = Math.min(score, CAP[i]!);
  return { ...q, score: Math.round(clamp01(score) * 1000) / 1000 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

export function estimateFps(seq: PoseSequence): number {
  const n = seq.frames.length;
  if (n < 2) return 0;
  const d: number[] = [];
  for (let i = 1; i < n; i++) d.push(seq.frames[i].t - seq.frames[i - 1].t);
  const m = median(d);
  return m > 0 ? 1000 / m : 0;
}

/** median shoulder-centre to hip-centre distance (pixel space) */
export function torsoLength(lms: Landmark[][], aspect: number): number {
  return median(
    lms.map((lm) => {
      const ls = pt(lm, LM.LEFT_SHOULDER, aspect, 0.3);
      const rs = pt(lm, LM.RIGHT_SHOULDER, aspect, 0.3);
      const lh = pt(lm, LM.LEFT_HIP, aspect, 0.3);
      const rh = pt(lm, LM.RIGHT_HIP, aspect, 0.3);
      return ls && rs && lh && rh ? dist(mid(ls, rs), mid(lh, rh)) : NaN;
    }),
  );
}

/** share of frames where the head, a foot or a hand is outside the picture (or the feet are not visible) */
export function cutOffShare(lms: Landmark[][]): number {
  if (!lms.length) return 0;
  const out = (p: Landmark) => p.x < -0.01 || p.x > 1.01 || p.y < -0.01 || p.y > 1.01;
  let c = 0;
  for (const lm of lms) {
    const head = lm[LM.NOSE].y < 0.02 || out(lm[LM.NOSE]);
    const feet = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE].some((j) => out(lm[j]) || lm[j].y > 0.99 || lm[j].v < 0.3);
    const hands = [LM.LEFT_WRIST, LM.RIGHT_WRIST].some((j) => out(lm[j]));
    if (head || feet || hands) c++;
  }
  return c / lms.length;
}

const percentile = (v: number[], p: number) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

/** How far the steadier ankle wanders (p10–p90 spread, pixel space). Large → the camera moved. */
export function footDrift(lms: Landmark[][], aspect: number): number {
  const spread = (j: number) => {
    const xs = lms.map((lm) => lm[j].x * aspect);
    const ys = lms.map((lm) => lm[j].y);
    return Math.hypot(percentile(xs, 0.9) - percentile(xs, 0.1), percentile(ys, 0.9) - percentile(ys, 0.1));
  };
  return Math.min(spread(LM.LEFT_ANKLE), spread(LM.RIGHT_ANKLE));
}

/** median player height as a share of the frame height (nose to the lowest foot point, +12 % for the top of the head) */
export function playerHeight(lms: Landmark[][]): number {
  return median(
    lms.map((lm) => {
      const feet = Math.max(lm[LM.LEFT_ANKLE].y, lm[LM.RIGHT_ANKLE].y, lm[LM.LEFT_HEEL].y, lm[LM.RIGHT_HEEL].y, lm[LM.LEFT_FOOT].y, lm[LM.RIGHT_FOOT].y);
      return (feet - lm[LM.NOSE].y) * 1.12;
    }),
  );
}

const hands = (lm: Landmark[], aspect: number): Vec2 | null => {
  const a = pt(lm, LM.LEFT_WRIST, aspect, 0.2);
  const b = pt(lm, LM.RIGHT_WRIST, aspect, 0.2);
  return a && b ? mid(a, b) : a ?? b;
};

/**
 * Face-on: in the canonical frame the hands must move to the image LEFT in the backswing. Down-the-line: the player
 * faces image right, so the hands are right of the hips at address. Otherwise the video is mirrored or the chosen
 * handedness is wrong.
 */
export function mirroredSuspected(seq: PoseSequence, ctx: AnalysisContext, torso: number, keyframes?: PhaseKeyframe[]): boolean {
  const aspect = aspectOf(seq);
  const frames = seq.frames;
  const det = frames.map((f, i) => ({ i, lm: f.lm })).filter((f): f is { i: number; lm: Landmark[] } => !!f.lm);
  if (det.length < 5) return false;
  const kf = (p: string) => keyframes?.find((k) => k.position === p)?.frameIndex;
  // address reference: key frame or the median of the first 10 % of detected frames
  const addrIdx = kf('address');
  const head = det.slice(0, Math.max(3, Math.round(det.length * 0.1)));
  const addrLm = addrIdx !== undefined && frames[addrIdx]?.lm ? [frames[addrIdx].lm!] : head.map((d) => d.lm);
  const hs = addrLm.map((lm) => hands(lm, aspect)).filter((h): h is Vec2 => !!h);
  if (!hs.length) return false;
  const addr = { x: median(hs.map((h) => h.x)), y: median(hs.map((h) => h.y)) };

  if (ctx.view === 'down_the_line') {
    const hips = addrLm
      .map((lm) => {
        const a = pt(lm, LM.LEFT_HIP, aspect, 0.2);
        const b = pt(lm, LM.RIGHT_HIP, aspect, 0.2);
        return a && b ? mid(a, b).x : NaN;
      })
      .filter(Number.isFinite);
    if (!hips.length) return false;
    return addr.x < median(hips) - 0.2 * torso;
  }

  // face-on: direction of the first large excursion of the hands (half of the largest excursion of the clip)
  const startPos = addrIdx ?? det[0].i;
  const topIdx = kf('top');
  let probe: Vec2 | null = null;
  if (topIdx !== undefined && frames[topIdx]?.lm) probe = hands(frames[topIdx].lm!, aspect);
  else {
    const after = det.filter((d) => d.i >= startPos);
    const dists = after.map((d) => {
      const h = hands(d.lm, aspect);
      return h ? dist(h, addr) : 0;
    });
    const maxD = Math.max(...dists);
    if (maxD < 0.15 * torso) return false; // hardly any movement → nothing to judge
    const k = dists.findIndex((d) => d >= maxD * 0.5);
    probe = hands(after[k].lm, aspect);
  }
  if (!probe) return false;
  return (probe.x - addr.x) / torso > QUALITY_LIMITS.mirroredHandShift;
}
