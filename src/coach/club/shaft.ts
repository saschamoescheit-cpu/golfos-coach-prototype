import { LM } from '../model/constants';
import { angleDiff, pt } from '../model/geometry';
import type { ClubEstimate, Vec2 } from '../model/types';
import type { ClubFrameInput, ClubProvider, GrayImage } from './ClubProvider';
import { CLUB_TORSO_RATIO, bodyFrame } from './hands';
import { clubFromPoints } from './lines';

/**
 * ImageShaftProvider – finds the shaft as a thin straight line in the grayscale frame, starting at the hands
 * (decision S2). Plain TypeScript, no dependencies, ~1–3 ms per 360 px frame.
 *
 * Algorithm
 * 1. Body scale from the landmarks: hand centre (mid of the wrists) and torso length; expected club length
 *    = CLUB_TORSO_RATIO × torso (upper bound – the shaft is often foreshortened).
 * 2. Ridge maps for both polarities (dark shaft on bright background, bright shaft on dark background):
 *    per pixel max over 4 directions of min(side A, side B) − centre. A step edge (arm, leg, wall) has one side
 *    equal to the centre → no response; only thin lines respond. Maps are dilated 3×3 so rays may be 1 px off.
 * 3. Body masking: ridges inside capsules around forearms and legs are down-weighted (shirt folds, gap between the
 *    arms, trouser creases).
 * 4. Line search: lines through a point near the hands (perpendicular offset ±0.08 torso, because the wrist landmark
 *    is not exactly on the shaft) at 1° steps. Along each line, samples are hits/misses; the shaft extent is the
 *    maximal prefix sum (hit +1, miss −0.5) going outward from the hands. Penalties: evidence on the opposite side of
 *    the hands (a real shaft ends at the hands, a horizon/wall line does not) and evidence far beyond the club length.
 *    Lines pointing towards an elbow are excluded (forearms are not the club).
 * 5. Soft priors: previous frame's angle and the tracker's predicted angle.
 * 6. Sub-degree refinement on the raw image with bilinear sampling.
 * 7. Confidence from covered length, contrast and ambiguity (second-best line ≥ 12° away). Null when unsure.
 */

export interface ShaftDetection {
  club: ClubEstimate;
  polarity: 'dark' | 'bright';
  /** visible shaft length from the hand centre in image pixels */
  lengthPx: number;
  /** expected full club length in image pixels */
  expectedPx: number;
  score: number;
  secondScore: number;
}

// REVIEW(golf): tuning constants of the line search (not golf thresholds, but they decide what counts as "shaft")
const R0_TORSO = 0.2; // skip the hand blob
const OPP_FROM_TORSO = 0.35; // butt end sticks out ≈ 0.15 torso beyond the hands
const OFFSET_TORSO = 0.08;
const OFFSET_STEP = 3; // px between parallel candidate lines (ridge band is ~5 px wide after dilation)
const ANGLE_STEP = 1.5; // deg, coarse search; refined to 0.2°
const ELBOW_EXCLUDE_DEG = 30;
const MISS_PENALTY = 0.5;
const MIN_CONFIDENCE = 0.15;

interface Candidate {
  dirDeg: number;
  offset: number;
  pol: 0 | 1; // 0 dark, 1 bright
  score: number;
  hits: number;
  lengthPx: number;
}

function noiseSigma(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  // median of horizontal neighbour differences (histogram, no sort) ≈ 0.954 σ for Gaussian noise
  const hist = new Uint32Array(256);
  const { data, width: w } = img;
  let n = 0;
  for (let y = y0; y <= y1; y += 3)
    for (let x = x0; x < x1; x += 3) {
      hist[Math.abs(data[y * w + x + 1] - data[y * w + x])]++;
      n++;
    }
  if (!n) return 0;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n / 2) return v / 0.954;
  }
  return 255;
}

function percentile(arr: Uint8Array, idx: Int32Array, n: number, p: number): number {
  const hist = new Uint32Array(256);
  for (let k = 0; k < n; k++) hist[arr[idx[k]]]++;
  let acc = 0;
  const target = n * p;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

function dilate3(src: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      let m = src[i];
      if (x > x0 && src[i - 1] > m) m = src[i - 1];
      if (x < x1 && src[i + 1] > m) m = src[i + 1];
      tmp[i] = m;
    }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      let m = tmp[i];
      if (y > y0 && tmp[i - w] > m) m = tmp[i - w];
      if (y < y1 && tmp[i + w] > m) m = tmp[i + w];
      out[i] = m;
    }
  return out;
}

/** Multiply ridge values inside a capsule (segment a–b, radius r) by `f`. */
function weakenCapsule(maps: Uint8Array[], w: number, h: number, a: Vec2, b: Vec2, r: number, f: number) {
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      const ex = a.x + t * dx - x;
      const ey = a.y + t * dy - y;
      if (ex * ex + ey * ey <= r * r) for (const m of maps) m[y * w + x] = m[y * w + x] * f;
    }
}

function bilinear(img: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return -1;
  const xi = Math.min(img.width - 2, Math.floor(x));
  const yi = Math.min(img.height - 2, Math.floor(y));
  const fx = x - xi;
  const fy = y - yi;
  const i = yi * img.width + xi;
  const d = img.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + img.width] * (1 - fx) + d[i + img.width + 1] * fx) * fy;
}

/** Line contrast at (x, y) with unit normal n; −Infinity when outside. */
function lineContrast(img: GrayImage, x: number, y: number, nx: number, ny: number, side: number, pol: 0 | 1): number {
  const c = bilinear(img, x, y);
  const a = bilinear(img, x + nx * side, y + ny * side);
  const b = bilinear(img, x - nx * side, y - ny * side);
  if (c < 0 || a < 0 || b < 0) return -Infinity;
  return pol === 0 ? Math.min(a, b) - c : c - Math.max(a, b);
}

/** Maximal prefix sum of hit(+1)/miss(−MISS_PENALTY)/unknown(0) samples. Returns [sum, end index (exclusive), hits]. */
function maxPrefix(vals: Int8Array, from: number, to: number): [number, number, number] {
  let s = 0;
  let best = 0;
  let end = from;
  let hits = 0;
  let bestHits = 0;
  for (let k = from; k < to; k++) {
    const v = vals[k];
    if (v > 0) {
      s += 1;
      hits++;
    } else if (v < 0) s -= MISS_PENALTY;
    if (s > best) {
      best = s;
      end = k + 1;
      bestHits = hits;
    }
  }
  return [best, end, bestHits];
}

export function detectShaft(input: ClubFrameInput): ShaftDetection | null {
  const img = input.image;
  if (!img || img.width < 16 || img.height < 16) return null;
  const W = img.width;
  const H = img.height;
  const body = bodyFrame(input.lm, W / H);
  if (!body) return null;
  const S = H; // pixel space → image pixels
  const hx = body.hands.x * S;
  const hy = body.hands.y * S;
  const torso = body.torso * S;
  if (torso < 8) return null;

  // REVIEW(golf): face-on the torso appears shorter (forward bend) → allow a longer club in the image
  const fullLen = CLUB_TORSO_RATIO[input.shotType] * torso * (input.view === 'face_on' ? 1.25 : 1.05);
  const capLen = fullLen * 1.2;
  const rMax = fullLen * 1.7;
  const r0 = R0_TORSO * torso;
  const rOpp = OPP_FROM_TORSO * torso;

  // ---- ridge maps in the region of interest (disc around the hands)
  const side = Math.max(2, Math.round(Math.min(W, H) / 70));
  const diag = Math.max(1, Math.round(side / Math.SQRT2));
  const x0 = Math.max(side, Math.floor(hx - rMax));
  const x1 = Math.min(W - 1 - side, Math.ceil(hx + rMax));
  const y0 = Math.max(side, Math.floor(hy - rMax));
  const y1 = Math.min(H - 1 - side, Math.ceil(hy + rMax));
  if (x1 <= x0 || y1 <= y0) return null;
  const dark = new Uint8Array(W * H);
  const bright = new Uint8Array(W * H);
  const o0 = side;
  const o1 = side * W;
  const o2 = diag + diag * W;
  const o3 = diag - diag * W;
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    // only the disc of radius rMax around the hands
    const dy = y - hy;
    const half = rMax * rMax - dy * dy;
    if (half < 0) continue;
    const hw = Math.sqrt(half);
    const xa = Math.max(x0, Math.floor(hx - hw));
    const xb = Math.min(x1, Math.ceil(hx + hw));
    for (let x = xa, i = y * W + xa; x <= xb; x++, i++) {
      const c = d[i];
      let a = d[i + o0];
      let b = d[i - o0];
      let lo = a < b ? a : b;
      let hi = a < b ? b : a;
      let dk = lo - c;
      let br = c - hi;
      a = d[i + o1];
      b = d[i - o1];
      lo = a < b ? a : b;
      hi = a < b ? b : a;
      if (lo - c > dk) dk = lo - c;
      if (c - hi > br) br = c - hi;
      a = d[i + o2];
      b = d[i - o2];
      lo = a < b ? a : b;
      hi = a < b ? b : a;
      if (lo - c > dk) dk = lo - c;
      if (c - hi > br) br = c - hi;
      a = d[i + o3];
      b = d[i - o3];
      lo = a < b ? a : b;
      hi = a < b ? b : a;
      if (lo - c > dk) dk = lo - c;
      if (c - hi > br) br = c - hi;
      dark[i] = dk > 0 ? dk : 0;
      bright[i] = br > 0 ? br : 0;
    }
  }
  const maps = [dilate3(dark, W, x0, y0, x1, y1), dilate3(bright, W, x0, y0, x1, y1)];

  // ---- body masking (pixel space → image px)
  const P = (i: number) => {
    const p = pt(input.lm, i, W / H, 0.3);
    return p ? { x: p.x * S, y: p.y * S } : null;
  };
  const segs: [number, number, number][] = [
    [LM.LEFT_ELBOW, LM.LEFT_WRIST, 0.09],
    [LM.RIGHT_ELBOW, LM.RIGHT_WRIST, 0.09],
    [LM.LEFT_HIP, LM.LEFT_KNEE, 0.11],
    [LM.LEFT_KNEE, LM.LEFT_ANKLE, 0.09],
    [LM.RIGHT_HIP, LM.RIGHT_KNEE, 0.11],
    [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, 0.09],
  ];
  for (const [ia, ib, rr] of segs) {
    const a = P(ia);
    const b = P(ib);
    if (a && b) weakenCapsule(maps, W, H, a, b, rr * torso, 0.35);
  }

  // ---- adaptive hit threshold per polarity
  const sigma = noiseSigma(img, x0, y0, x1 - 1, y1);
  const roiIdx = new Int32Array(Math.ceil((x1 - x0 + 1) / 2) * Math.ceil((y1 - y0 + 1) / 2));
  let nIdx = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) roiIdx[nIdx++] = y * W + x;
  const thr = maps.map((m) => Math.max(10, 3 * sigma, 1.15 * percentile(m, roiIdx, nIdx, 0.9)));

  // ---- elbow directions (excluded)
  const elbowDirs: number[] = [];
  for (const e of [P(LM.LEFT_ELBOW), P(LM.RIGHT_ELBOW)]) {
    if (e && Math.hypot(e.x - hx, e.y - hy) > 0.15 * torso) elbowDirs.push((Math.atan2(e.y - hy, e.x - hx) * 180) / Math.PI);
  }
  const prevAngle = input.prev && input.prev.source !== 'hands' ? input.prev.angleDeg : undefined;
  const predicted = input.predictedAngleDeg;

  // ---- coarse search over lines through the hand region
  const step = 2;
  const nS = Math.ceil(rMax / step);
  const kStart = Math.floor(r0 / step);
  const kCap = Math.min(nS, Math.ceil(capLen / step));
  const kOppFrom = Math.floor(rOpp / step);
  const kOppTo = Math.min(nS, Math.ceil(fullLen / step));
  const nOff = Math.max(1, Math.round((OFFSET_TORSO * torso) / OFFSET_STEP));
  const fwd = [new Int8Array(nS), new Int8Array(nS)];
  const bwd = [new Int8Array(nS), new Int8Array(nS)];
  const cands: Candidate[] = [];
  const sumHits = (v: Int8Array, a: number, b: number) => {
    let s = 0;
    for (let k = a; k < b; k++) if (v[k] > 0) s++;
    return s;
  };

  const [mapD, mapB] = maps;
  const [thrD, thrB] = thr;
  const [fD, fB] = fwd;
  const [bD, bB] = bwd;
  for (let ai = 0; ai < 180 / ANGLE_STEP; ai++) {
    const deg0 = ai * ANGLE_STEP;
    const th = (deg0 * Math.PI) / 180;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const nx = -uy;
    const ny = ux;
    for (let oi = -nOff; oi <= nOff; oi++) {
      const o = oi * OFFSET_STEP;
      const ox = hx + nx * o + 0.5; // +0.5: floor() below rounds
      const oy = hy + ny * o + 0.5;
      const sx = ux * step;
      const sy = uy * step;
      for (let k = 0; k < nS; k++) {
        let x = Math.floor(ox + sx * k);
        let y = Math.floor(oy + sy * k);
        if (x < x0 || x > x1 || y < y0 || y > y1) {
          fD[k] = 0;
          fB[k] = 0;
        } else {
          const i = y * W + x;
          fD[k] = mapD[i] >= thrD ? 1 : -1;
          fB[k] = mapB[i] >= thrB ? 1 : -1;
        }
        x = Math.floor(ox - sx * k);
        y = Math.floor(oy - sy * k);
        if (x < x0 || x > x1 || y < y0 || y > y1) {
          bD[k] = 0;
          bB[k] = 0;
        } else {
          const i = y * W + x;
          bD[k] = mapD[i] >= thrD ? 1 : -1;
          bB[k] = mapB[i] >= thrB ? 1 : -1;
        }
      }
      for (let pol = 0 as 0 | 1; pol < 2; pol = (pol + 1) as 0 | 1) {
        for (let sgn = 0; sgn < 2; sgn++) {
          const here = sgn === 0 ? fwd[pol] : bwd[pol];
          const there = sgn === 0 ? bwd[pol] : fwd[pol];
          const [best, end, hits] = maxPrefix(here, kStart, kCap);
          if (hits < 4) continue;
          const dirDeg = sgn === 0 ? deg0 : deg0 - 180;
          if (elbowDirs.some((e) => Math.abs(angleDiff(dirDeg, e)) < ELBOW_EXCLUDE_DEG)) continue;
          const opp = sumHits(there, kOppFrom, kOppTo);
          const beyond = sumHits(here, Math.max(end, kCap), nS);
          let score = best - 0.8 * opp - 0.5 * beyond;
          if (score <= 0) continue;
          if (prevAngle !== undefined) score *= 0.7 + 0.3 * Math.exp(-((angleDiff(dirDeg, prevAngle) / 45) ** 2));
          if (predicted !== undefined) score *= 0.7 + 0.3 * Math.exp(-((angleDiff(dirDeg, predicted) / 30) ** 2));
          cands.push({ dirDeg, offset: o, pol, score, hits, lengthPx: end * step });
        }
      }
    }
  }
  if (!cands.length) return null;
  let best = cands[0];
  for (const c of cands) if (c.score > best.score) best = c;
  let second = 0;
  for (const c of cands) if (c.score > second && Math.abs(angleDiff(c.dirDeg, best.dirDeg)) > 12) second = c.score;

  // ---- refinement on the raw image (two stages; the coarse search is blunt for short visible segments)
  const T = thr[best.pol];
  const cap = 4 * T;
  // offsets are measured along the normal of the coarse line orientation; keep that frame throughout
  const th0 = (((best.dirDeg % 180) + 180) % 180) * (Math.PI / 180);
  const n0x = -Math.sin(th0);
  const n0y = Math.cos(th0);
  const refine = (a0: number, o0: number, aRange: number, aStep: number, oRange: number, oStep: number, tStep: number) => {
    let bestRef = -Infinity;
    const grid: { a: number; o: number; s: number }[] = [];
    for (let da = -aRange; da <= aRange + 1e-6; da += aStep) {
      const th = ((a0 + da) * Math.PI) / 180;
      const ux = Math.cos(th);
      const uy = Math.sin(th);
      for (let dofs = -oRange; dofs <= oRange + 1e-6; dofs += oStep) {
        const o = o0 + dofs;
        const ox = hx + n0x * o;
        const oy = hy + n0y * o;
        let s = 0;
        for (let t = r0; t <= best.lengthPx; t += tStep) {
          const c = lineContrast(img, ox + ux * t, oy + uy * t, -uy, ux, side, best.pol);
          if (c > 0) s += c < cap ? c : cap;
        }
        grid.push({ a: a0 + da, o, s });
        if (s > bestRef) bestRef = s;
      }
    }
    let wa = 0;
    let wo = 0;
    let wsum = 0;
    for (const g of grid)
      if (g.s >= 0.97 * bestRef) {
        wa += g.a * g.s;
        wo += g.o * g.s;
        wsum += g.s;
      }
    return wsum > 0 ? { a: wa / wsum, o: wo / wsum } : { a: a0, o: o0 };
  };
  const shortSeg = best.lengthPx < 0.6 * fullLen;
  const stage1 = refine(best.dirDeg, best.offset, shortSeg ? 10 : 4, 1, OFFSET_STEP + 2, 1, 2);
  const stage2 = refine(stage1.a, stage1.o, 1, 0.2, 1, 0.25, 1);
  const dirDeg = stage2.a;
  const offset = stage2.o;
  const ox = hx - Math.sin(th0) * offset;
  const oy = hy + Math.cos(th0) * offset;
  const th = (dirDeg * Math.PI) / 180;
  const ux = Math.cos(th);
  const uy = Math.sin(th);

  // visible length along the refined line
  let s = 0;
  let bestS = 0;
  let L = best.lengthPx;
  let contrastSum = 0;
  let nHit = 0;
  for (let t = r0; t <= capLen; t += 1) {
    const c = lineContrast(img, ox + ux * t, oy + uy * t, -uy, ux, side, best.pol);
    if (c === -Infinity) continue;
    if (c >= 0.7 * T) {
      s += 1;
      contrastSum += c;
      nHit++;
    } else s -= MISS_PENALTY;
    if (s > bestS) {
      bestS = s;
      L = t;
    }
  }

  // ---- confidence
  // expected visible length: full club, but limited by the image border
  let inImage = 0;
  for (let t = r0; t <= fullLen; t += 2) {
    const x = ox + ux * t;
    const y = oy + uy * t;
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) break;
    inImage = t;
  }
  const expected = Math.max(inImage - r0, 0.5 * torso);
  const cov = Math.min(1, (best.hits * step) / expected);
  const confLen = Math.max(0, Math.min(1, (cov - 0.12) / 0.45));
  const confAmb = Math.max(0.3, Math.min(1, (1 - second / best.score) / 0.4));
  const meanContrast = nHit ? contrastSum / nHit : 0;
  const confContrast = Math.max(0.3, Math.min(1, meanContrast / (2 * T)));
  const confidence = 0.95 * confLen * confAmb * confContrast;
  if (confidence < MIN_CONFIDENCE) return null;

  const gripT = -0.12 * torso;
  const toNorm = (t: number): Vec2 => ({ x: (ox + ux * t) / W, y: (oy + uy * t) / H });
  const club = clubFromPoints(toNorm(gripT), toNorm(Math.max(L, r0)), input.aspect, 'image', confidence);
  return {
    club,
    polarity: best.pol === 0 ? 'dark' : 'bright',
    lengthPx: L,
    expectedPx: fullLen,
    score: best.score,
    secondScore: second,
  };
}

export class ImageShaftProvider implements ClubProvider {
  readonly id = 'image';
  estimate(input: ClubFrameInput): ClubEstimate | null {
    return detectShaft(input)?.club ?? null;
  }
}
