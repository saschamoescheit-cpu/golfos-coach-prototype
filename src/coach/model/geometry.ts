import type { Landmark, PoseSequence, Vec2 } from './types';

/**
 * Small geometry helpers. "Pixel space" = normalized coordinates with x multiplied by the aspect ratio (width/height),
 * so that angles and distances are correct on non-square videos. All helpers here work in pixel space.
 */

export function toPx(p: { x: number; y: number }, aspect: number): Vec2 {
  return { x: p.x * aspect, y: p.y };
}

export function fromPx(p: Vec2, aspect: number): Vec2 {
  return { x: p.x / aspect, y: p.y };
}

export function aspectOf(seq: Pick<PoseSequence, 'width' | 'height'>): number {
  return seq.height > 0 ? seq.width / seq.height : 1;
}

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Direction angle of vector a→b in degrees, 0 = image right, 90 = image down. Range (−180, 180]. */
export function angleOf(a: Vec2, b: Vec2): number {
  return deg(Math.atan2(b.y - a.y, b.x - a.x));
}

/** Inner angle at vertex b of the polyline a-b-c, in degrees 0..180 (180 = straight). */
export function jointAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const n = len(u) * len(v);
  if (n === 0) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / n))));
}

/** Smallest signed difference a − b between two angles in degrees, result in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Signed perpendicular distance of p from the infinite line a→b (positive = left of the direction a→b in image coords). */
export function signedDistanceToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return 0;
  return cross(d, sub(p, a)) / l;
}

/** Point of landmark i in pixel space, or null when missing / not visible enough. */
export function pt(lm: Landmark[] | null | undefined, i: number, aspect: number, minVis = 0): Vec2 | null {
  if (!lm) return null;
  const p = lm[i];
  if (!p || p.v < minVis || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x * aspect, y: p.y };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
