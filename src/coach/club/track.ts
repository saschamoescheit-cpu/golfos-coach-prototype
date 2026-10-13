import { add, angleDiff, aspectOf, median, scale, sub } from '../model/geometry';
import type { ClubEstimate, Line2, PoseSequence, Vec2 } from '../model/types';
import type { AnalysisContext } from '../analysis/context';
import type { ClubProvider, GrayImage } from './ClubProvider';
import { bodyFrame, HandClubProvider } from './hands';
import { CLUB_MEASURED_MIN, clubFromPoints } from './lines';
import { ImageShaftProvider } from './shaft';

export * from './lines';
export { CLUB_TORSO_RATIO, HANDS_MAX_CONFIDENCE, HandClubProvider } from './hands';
export { detectShaft, ImageShaftProvider } from './shaft';

export interface ClubTrack {
  /** one entry per frame of seq (null = unknown) */
  club: (ClubEstimate | null)[];
  /** neutral line = address shaft extended (only meaningful down-the-line; computed for both views) */
  neutralLine: Line2 | null;
  // ---- additive (club agent)
  /** frames [first, last] the neutral line was taken from (still hands before the takeaway), null when not found */
  addressFrames?: [number, number] | null;
  /** 0..1 trust in the neutral line; 0 when it is null */
  neutralConfidence?: number;
  /** share of frames with a person where the shaft was found in the image (quality hint 'club_not_found') */
  imageRatio?: number;
}

export interface TrackOptions {
  imageProvider?: ClubProvider;
  handProvider?: ClubProvider;
}

// REVIEW(golf): tracking constants
/** image results below this confidence are dropped in favour of the hand estimate */
const IMAGE_ACCEPT = 0.25;
/** a single frame jumping this far away from both (agreeing) neighbours is treated as a mis-detection */
const OUTLIER_DEG = 25;
/** longest gap that is interpolated between two image detections (s); longer gaps keep the hand estimate */
const MAX_GAP_S = 0.07;
/** never interpolate across more than this rotation (downswing near impact turns > 30°/frame at 30 fps) */
const MAX_GAP_TURN_DEG = 120;
/** hands slower than this (torso lengths per second) count as still – address, before the takeaway */
const STILL_SPEED = 0.35;
const STILL_MIN_S = 0.15;
/** hands further than this (torso lengths) from their address position = takeaway has started */
const STILL_RADIUS = 0.05;
const ADDRESS_WINDOW_S = 0.5;

interface Polar {
  grip: Vec2; // pixel space
  angle: number;
  len: number; // pixel space
  source: ClubEstimate['source'];
  conf: number;
}

const toPolar = (c: ClubEstimate, aspect: number): Polar => {
  const g = { x: c.grip.x * aspect, y: c.grip.y };
  return {
    grip: g,
    angle: c.angleDeg,
    len: Math.hypot((c.head.x - c.grip.x) * aspect, c.head.y - c.grip.y),
    source: c.source,
    conf: c.confidence,
  };
};

const fromPolar = (p: Polar, aspect: number): ClubEstimate => {
  const r = (p.angle * Math.PI) / 180;
  const head = add(p.grip, scale({ x: Math.cos(r), y: Math.sin(r) }, p.len));
  return clubFromPoints({ x: p.grip.x / aspect, y: p.grip.y }, { x: head.x / aspect, y: head.y }, aspect, p.source, p.conf);
};

const isImg = (p: Polar | null | undefined, minConf = 0): p is Polar => !!p && p.source === 'image' && p.conf >= minConf;

/**
 * OWNER: agent "club" (work package C, ClubProvider).
 * Track the shaft through the swing. `images` are canonical-orientation grayscale frames (same length as seq.frames,
 * entries may be undefined). Without images the hand-estimate provider is used for every frame.
 *
 * Steps: per frame image provider (with previous / predicted angle as prior) → fallback hands; reject single-frame
 * outliers; interpolate short gaps between image detections; light 1-2-1 smoothing of angle, grip and length;
 * neutral line = median address shaft (still hands before the takeaway), extended beyond the hands.
 */
export function trackClub(
  seq: PoseSequence,
  images: (GrayImage | undefined)[] | undefined,
  ctx: AnalysisContext,
  opts: TrackOptions = {},
): ClubTrack {
  const aspect = aspectOf(seq);
  const n = seq.frames.length;
  const imageProvider = opts.imageProvider ?? new ImageShaftProvider();
  const handProvider = opts.handProvider ?? new HandClubProvider();
  const tracks: (Polar | null)[] = new Array(n).fill(null);
  const handsOnly: (Polar | null)[] = new Array(n).fill(null);
  let lastImg: ClubEstimate | null = null;

  // ---- 1. per-frame estimates
  for (let i = 0; i < n; i++) {
    const lm = seq.frames[i].lm;
    if (!lm) continue;
    const base = { lm, aspect, view: ctx.view, shotType: ctx.shotType };
    const h = handProvider.estimate(base);
    handsOnly[i] = h ? toPolar(h, aspect) : null;
    const image = images?.[i];
    let est: ClubEstimate | null = null;
    if (image) {
      const p1 = tracks[i - 1];
      const p2 = tracks[i - 2];
      let predicted: number | undefined;
      if (isImg(p1) && isImg(p2)) predicted = p1.angle + angleDiff(p1.angle, p2.angle);
      else if (isImg(p1)) predicted = p1.angle;
      est = imageProvider.estimate({ ...base, image, prev: isImg(p1) ? lastImg : null, predictedAngleDeg: predicted });
      if (est && est.confidence < IMAGE_ACCEPT) est = null;
    }
    if (est) {
      lastImg = est;
      tracks[i] = toPolar(est, aspect);
    } else tracks[i] = handsOnly[i];
  }

  // ---- 2. single-frame outliers among image detections
  for (let i = 1; i < n - 1; i++) {
    const a = tracks[i - 1];
    const b = tracks[i];
    const c = tracks[i + 1];
    if (!isImg(a) || !isImg(b) || !isImg(c)) continue;
    const span = angleDiff(c.angle, a.angle);
    if (Math.abs(span) > 90) continue;
    const pred = a.angle + span / 2;
    if (Math.abs(angleDiff(b.angle, pred)) > OUTLIER_DEG) tracks[i] = handsOnly[i];
  }

  // ---- 3. interpolate short gaps between confident image detections
  const maxGap = Math.max(1, Math.round(MAX_GAP_S * seq.fps));
  let lastAnchor = -1;
  for (let i = 0; i < n; i++) {
    if (!isImg(tracks[i], CLUB_MEASURED_MIN)) continue;
    const gap = i - lastAnchor - 1;
    if (lastAnchor >= 0 && gap > 0 && gap <= maxGap) {
      const A = tracks[lastAnchor]!;
      const B = tracks[i]!;
      const turn = angleDiff(B.angle, A.angle);
      const between = tracks.slice(lastAnchor + 1, i);
      if (Math.abs(turn) <= MAX_GAP_TURN_DEG && between.every((p) => !isImg(p, CLUB_MEASURED_MIN))) {
        for (let k = 1; k <= gap; k++) {
          const f = k / (gap + 1);
          tracks[lastAnchor + k] = {
            grip: add(A.grip, scale(sub(B.grip, A.grip), f)),
            angle: A.angle + turn * f,
            len: A.len + (B.len - A.len) * f,
            source: 'image',
            conf: Math.min(A.conf, B.conf) * (1 - 0.08 * gap),
          };
        }
      }
    }
    lastAnchor = i;
  }

  // ---- 4. light smoothing within runs of the same source (1-2-1; hands twice because they are noisy)
  const smoothRuns = (src: ClubEstimate['source'], passes: number, maxCurv: number) => {
    for (let pass = 0; pass < passes; pass++) {
      const copy = tracks.map((p) => (p ? { ...p } : null));
      for (let i = 1; i < n - 1; i++) {
        const a = copy[i - 1];
        const b = copy[i];
        const c = copy[i + 1];
        if (!a || !b || !c || a.source !== src || b.source !== src || c.source !== src) continue;
        const da = angleDiff(a.angle, b.angle);
        const dc = angleDiff(c.angle, b.angle);
        if (Math.abs(da + dc) > maxCurv) continue; // sharp change → keep the measurement
        tracks[i] = {
          ...b,
          angle: b.angle + (da + dc) / 4,
          grip: { x: (a.grip.x + 2 * b.grip.x + c.grip.x) / 4, y: (a.grip.y + 2 * b.grip.y + c.grip.y) / 4 },
          len: (a.len + 2 * b.len + c.len) / 4,
        };
      }
    }
  };
  smoothRuns('image', 1, 20);
  smoothRuns('hands', 2, 60);

  const club = tracks.map((p) => (p ? fromPolar(p, aspect) : null));

  // ---- 5. neutral line from the still address frames
  const addr = findAddressStill(seq);
  let neutralLine: Line2 | null = null;
  let neutralConfidence = 0;
  if (addr) {
    const sel = club.slice(addr[0], addr[1] + 1).filter((c): c is ClubEstimate => !!c && c.source === 'image' && c.confidence >= CLUB_MEASURED_MIN);
    const frames = addr[1] - addr[0] + 1;
    if (sel.length >= Math.max(2, Math.ceil(0.3 * frames))) {
      const ref = sel[0].angleDeg;
      const ang = ref + median(sel.map((c) => angleDiff(c.angleDeg, ref)));
      const ps = sel.map((c) => toPolar(c, aspect));
      const grip = { x: median(ps.map((p) => p.grip.x)), y: median(ps.map((p) => p.grip.y)) };
      const L = median(ps.map((p) => p.len));
      const r = (ang * Math.PI) / 180;
      const u = { x: Math.cos(r), y: Math.sin(r) };
      const head = add(grip, scale(u, L));
      const beyond = sub(grip, scale(u, L)); // one club length beyond the grip
      neutralLine = { a: { x: head.x / aspect, y: head.y }, b: { x: beyond.x / aspect, y: beyond.y } };
      neutralConfidence = median(sel.map((c) => c.confidence)) * Math.min(1, sel.length / frames / 0.6);
    }
  }

  const withPerson = seq.frames.filter((f) => f.lm).length;
  const imageCount = club.filter((c) => c && c.source === 'image').length;
  return {
    club,
    neutralLine,
    addressFrames: addr,
    neutralConfidence,
    imageRatio: withPerson ? imageCount / withPerson : 0,
  };
}

/**
 * Find the still address before the takeaway from the hand speed (phases are computed after the club).
 * Returns the last ≤ 0.5 s of the last still run (hands slower than STILL_SPEED for ≥ 0.15 s) before the fastest
 * hand movement whose hands are low (lower 40 % of the hand-height range). Null when no such run exists.
 */
export function findAddressStill(seq: PoseSequence): [number, number] | null {
  const aspect = aspectOf(seq);
  const n = seq.frames.length;
  if (n < 3 || !(seq.fps > 0)) return null;
  const hands: (Vec2 | null)[] = [];
  const torsos: number[] = [];
  for (const f of seq.frames) {
    const b = bodyFrame(f.lm, aspect);
    hands.push(b ? b.hands : null);
    if (b) torsos.push(b.torso);
  }
  const torso = median(torsos);
  if (!(torso > 0)) return null;
  // speed from the mean hand position over ~50 ms before vs. after the frame (landmark jitter would dominate a
  // frame-to-frame difference: 0.003 jitter at 60 fps ≈ 0.4 torso/s)
  const k = Math.max(1, Math.round(0.05 * seq.fps));
  const meanPos = (a: number, b: number): Vec2 | null => {
    let x = 0;
    let y = 0;
    let c = 0;
    for (let j = Math.max(0, a); j <= Math.min(n - 1, b); j++) {
      const h = hands[j];
      if (h) {
        x += h.x;
        y += h.y;
        c++;
      }
    }
    return c ? { x: x / c, y: y / c } : null;
  };
  const speed: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = meanPos(i - k, i);
    const b = meanPos(i, i + k);
    const span = Math.min(n - 1, i + k) - Math.max(0, i - k);
    if (a && b && span > 0) speed[i] = Math.hypot(b.x - a.x, b.y - a.y) / (((span + 1) / 2) / seq.fps) / torso;
  }
  let iMax = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(speed[i]) && (iMax < 0 || speed[i] > speed[iMax])) iMax = i;
  if (iMax < 0) return null;
  const ys = hands.filter((h): h is Vec2 => !!h).map((h) => h.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const lowY = yMin + 0.6 * (yMax - yMin);
  const minLen = Math.max(2, Math.round(STILL_MIN_S * seq.fps));

  let best: [number, number] | null = null;
  let i = 0;
  while (i < iMax) {
    if (!(speed[i] < STILL_SPEED)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < iMax && speed[j + 1] < STILL_SPEED) j++;
    const meanY = median(hands.slice(i, j + 1).map((h) => (h ? h.y : NaN)));
    if (j - i + 1 >= minLen && meanY >= lowY) best = [i, j];
    i = j + 1;
  }
  if (!best) return null;
  // the speed threshold reacts late to the slow start of the takeaway: end the address where the hands leave
  // a small circle around their address position (median of the run)
  const run = hands.slice(best[0], best[1] + 1).filter((h): h is Vec2 => !!h);
  const p0 = { x: median(run.map((h) => h.x)), y: median(run.map((h) => h.y)) };
  let end = best[0];
  for (let j = best[0]; j <= best[1]; j++) {
    const h = hands[j];
    if (h && Math.hypot(h.x - p0.x, h.y - p0.y) > STILL_RADIUS * torso) {
      if (j > Math.floor((best[0] + best[1]) / 2)) break; // early wobble (waggle) does not end the address
      continue;
    }
    end = j;
  }
  const win = Math.max(1, Math.round(ADDRESS_WINDOW_S * seq.fps));
  return [Math.max(best[0], end - win + 1), end];
}
