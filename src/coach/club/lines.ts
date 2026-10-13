import type { ClubEstimate, Line2, Vec2 } from '../model/types';
import { angleDiff, deg } from '../model/geometry';

/**
 * Line / shaft helpers for metrics and UI. All inputs are normalized image coordinates (canonical frame unless noted);
 * angles are measured in pixel space (x scaled by the aspect ratio width/height), 0 = image right, 90 = image down.
 */

/** Minimal confidence of a club estimate to count as measured (faults, score). Hand estimates are capped at 0.4. */
export const CLUB_MEASURED_MIN = 0.45;

/** True when a club value may be used for faults/score: found in the image (or set manually), confident enough. */
export function isMeasuredClub(c: ClubEstimate | null | undefined): c is ClubEstimate {
  return !!c && c.source !== 'hands' && c.confidence >= CLUB_MEASURED_MIN;
}

export function lineFromPoints(a: Vec2, b: Vec2): Line2 {
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

/** The shaft as a line grip → head. */
export function clubLine(c: ClubEstimate): Line2 {
  return lineFromPoints(c.grip, c.head);
}

/** Direction angle of a→b in degrees in pixel space, range (−180, 180]. */
export function lineAngleDeg(l: Line2, aspect: number): number {
  return deg(Math.atan2(l.b.y - l.a.y, (l.b.x - l.a.x) * aspect));
}

/** Reduce an angle difference to (−90, 90] – lines have no direction. */
export function undirectedDiff(a: number, b: number): number {
  let d = angleDiff(a, b);
  if (d > 90) d -= 180;
  if (d <= -90) d += 180;
  return d;
}

/**
 * Signed angle of the shaft against the neutral line (canonical down-the-line view), degrees in (−90, 90].
 * + = steep (shaft rotated clockwise on screen: the upper part moves right of / above the line),
 * − = flat (shaft rotated anticlockwise: left of / below the line). Direction of the shaft does not matter.
 */
export function shaftVsNeutralDeg(club: ClubEstimate, neutral: Line2, aspect: number): number {
  return undirectedDiff(club.angleDeg, lineAngleDeg(neutral, aspect));
}

/** Same for a raw shaft angle (degrees, pixel space). */
export function angleVsNeutralDeg(shaftAngleDeg: number, neutral: Line2, aspect: number): number {
  return undirectedDiff(shaftAngleDeg, lineAngleDeg(neutral, aspect));
}

/** Angle between the shaft and the horizontal, 0 = parallel to the ground ("9 o'clock"), 90 = vertical. */
export function shaftToHorizontalDeg(club: ClubEstimate): number {
  return Math.abs(undirectedDiff(club.angleDeg, 0));
}

/** Extend a line beyond b by `factor` × its length (e.g. the neutral line beyond the hands). */
export function extendLine(l: Line2, factorA: number, factorB: number): Line2 {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  return { a: { x: l.a.x - dx * factorA, y: l.a.y - dy * factorA }, b: { x: l.b.x + dx * factorB, y: l.b.y + dy * factorB } };
}

const mirrorPt = (p: Vec2): Vec2 => ({ x: 1 - p.x, y: p.y });

/** Mirror an angle horizontally (x → −x): θ → 180 − θ, normalized to (−180, 180]. */
export function mirrorAngle(a: number): number {
  return angleDiff(180 - a, 0);
}

/** Mirror a club horizontally (display of left-handed swings on the original video). */
export function mirrorClub(c: ClubEstimate): ClubEstimate {
  return { ...c, grip: mirrorPt(c.grip), head: mirrorPt(c.head), angleDeg: mirrorAngle(c.angleDeg) };
}

export function mirrorLine(l: Line2): Line2 {
  return { a: mirrorPt(l.a), b: mirrorPt(l.b) };
}

/** Club estimate from two normalized points (e.g. set manually by the player). */
export function clubFromPoints(grip: Vec2, head: Vec2, aspect: number, source: ClubEstimate['source'], confidence: number): ClubEstimate {
  return {
    grip: { x: grip.x, y: grip.y },
    head: { x: head.x, y: head.y },
    angleDeg: deg(Math.atan2(head.y - grip.y, (head.x - grip.x) * aspect)),
    source,
    confidence,
  };
}
