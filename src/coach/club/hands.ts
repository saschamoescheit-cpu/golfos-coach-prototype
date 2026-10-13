import { LM } from '../model/constants';
import { add, dist, len, mid, pt, scale, sub } from '../model/geometry';
import type { ClubEstimate, Landmark, ShotType, Vec2 } from '../model/types';
import type { ClubFrameInput, ClubProvider } from './ClubProvider';
import { clubFromPoints } from './lines';

/**
 * Club length relative to the torso (shoulder-centre to hip-centre). Club ≈ 0.86–1.1 m, torso ≈ 0.5 m.
 * REVIEW(golf): rough adult values (driver 45", iron 7 ≈ 37", wedges ≈ 35", putter ≈ 34"); torso projected
 * in the image is shorter face-on (forward bend), so the image provider only uses this as an upper bound.
 */
export const CLUB_TORSO_RATIO: Record<ShotType, number> = {
  driver: 2.1,
  iron: 1.8,
  bunker: 1.7,
  pitch: 1.7,
  chip: 1.7,
  putt: 1.65,
};

/** Hand estimates never claim more than this (decision S2: shown as "estimated", never used for faults). */
export const HANDS_MAX_CONFIDENCE = 0.4;

const MIN_VIS = 0.3;

export interface BodyFrame {
  /** points in pixel space (normalized, x × aspect) */
  leadWrist: Vec2 | null;
  trailWrist: Vec2 | null;
  leadElbow: Vec2 | null;
  trailElbow: Vec2 | null;
  /** hand centre: midpoint of the wrists (or the visible one) */
  hands: Vec2;
  /** torso length shoulder-centre → hip-centre (pixel space) */
  torso: number;
}

/** Body measures needed by the club providers, in pixel space. Null when hands or torso are missing. */
export function bodyFrame(lm: Landmark[] | null, aspect: number): BodyFrame | null {
  if (!lm) return null;
  const P = (i: number) => pt(lm, i, aspect, MIN_VIS);
  const ls = P(LM.LEFT_SHOULDER);
  const rs = P(LM.RIGHT_SHOULDER);
  const lh = P(LM.LEFT_HIP);
  const rh = P(LM.RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  const torso = dist(mid(ls, rs), mid(lh, rh));
  if (!(torso > 1e-4)) return null;
  const leadWrist = P(LM.LEFT_WRIST);
  const trailWrist = P(LM.RIGHT_WRIST);
  const hands = leadWrist && trailWrist ? mid(leadWrist, trailWrist) : leadWrist ?? trailWrist;
  if (!hands) return null;
  return { leadWrist, trailWrist, leadElbow: P(LM.LEFT_ELBOW), trailElbow: P(LM.RIGHT_ELBOW), hands, torso };
}

const unit = (v: Vec2): Vec2 | null => {
  const l = len(v);
  return l > 1e-9 ? scale(v, 1 / l) : null;
};

/**
 * Fallback: estimate the shaft from the arms only (source 'hands').
 *
 * Model (documented in docs/coach/decisions/club.md):
 * - Both hands hold the grip, the lead hand nearer the butt end, so the shaft runs through both wrists:
 *   direction ≈ lead wrist → trail wrist. Reliable only when the wrists are clearly apart in the image
 *   (reliability r = separation / (0.12 × torso), capped at 1).
 * - Otherwise the shaft roughly continues the lead forearm (elbow → wrist). This ignores the wrist hinge, so it is
 *   coarse (tens of degrees off at the top) – it only keeps the overlay alive.
 * - Direction = weighted sum of both unit vectors (wrists r, forearm 0.85·(1 − r) + 0.05).
 * - Grip (butt end) = lead wrist moved 0.07 torso back along the shaft; head = grip + club length (CLUB_TORSO_RATIO).
 * - Confidence = 0.1 + 0.3·r, i.e. never above HANDS_MAX_CONFIDENCE.
 */
export class HandClubProvider implements ClubProvider {
  readonly id = 'hands';

  estimate(input: ClubFrameInput): ClubEstimate | null {
    const b = bodyFrame(input.lm, input.aspect);
    if (!b) return null;
    const lead = b.leadWrist ?? b.hands;
    let dir: Vec2 = { x: 0, y: 0 };
    let r = 0;
    if (b.leadWrist && b.trailWrist) {
      const w = sub(b.trailWrist, b.leadWrist);
      // REVIEW(golf): wrists ~8–10 cm apart on the grip ≈ 0.17 torso; 0.12 torso = "clearly apart" in the image
      r = Math.min(1, len(w) / (0.12 * b.torso));
      const u = unit(w);
      if (u) dir = add(dir, scale(u, r));
    }
    const fa = b.leadElbow && b.leadWrist ? unit(sub(b.leadWrist, b.leadElbow)) : null;
    if (fa) dir = add(dir, scale(fa, 0.85 * (1 - r) + 0.05));
    const d = unit(dir);
    if (!d) return null;
    const clubLen = CLUB_TORSO_RATIO[input.shotType] * b.torso;
    const grip = sub(lead, scale(d, 0.07 * b.torso));
    const head = add(grip, scale(d, clubLen));
    const toNorm = (p: Vec2): Vec2 => ({ x: p.x / input.aspect, y: p.y });
    return clubFromPoints(toNorm(grip), toNorm(head), input.aspect, 'hands', Math.min(HANDS_MAX_CONFIDENCE, 0.1 + 0.3 * r));
  }
}
