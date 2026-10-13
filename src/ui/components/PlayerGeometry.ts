import type { ClubEstimate, Line2, PoseFrame, PoseSequence, Vec2 } from '../../coach/model/types';

/**
 * Pure helpers of the swing player (frame ↔ video time, display mirroring, neutral-line editing). Tested in Node.
 * OWNER: agent "capture-pose".
 */

/** Index of the frame shown at time tMs (pose clock): the last frame with t ≤ tMs (binary search). */
export function frameAtTime(frames: Pick<PoseFrame, 't'>[], tMs: number): number {
  if (!frames.length) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  if (tMs <= frames[0].t) return 0;
  if (tMs >= frames[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= tMs + 0.5) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Video time (seconds) at which frame i is shown; small offset so the seek lands inside the frame. */
export function videoTimeOfFrame(seq: Pick<PoseSequence, 'frames' | 'videoTimeScale'>, i: number): number {
  const f = seq.frames[Math.max(0, Math.min(seq.frames.length - 1, i))];
  if (!f) return 0;
  return (f.t * (seq.videoTimeScale ?? 1)) / 1000 + 0.001;
}

/** Pose time (ms) of a video time (seconds). */
export function poseTimeOfVideo(seq: Pick<PoseSequence, 'videoTimeScale'>, videoS: number): number {
  return (videoS * 1000) / (seq.videoTimeScale ?? 1);
}

const mx = (p: Vec2): Vec2 => ({ x: 1 - p.x, y: p.y });

/** Canonical → display (left-handers are shown as filmed). */
export function lineToDisplay(line: Line2 | null | undefined, mirrored: boolean): Line2 | null {
  if (!line) return null;
  return mirrored ? { a: mx(line.a), b: mx(line.b) } : line;
}
/** Display → canonical (inverse of lineToDisplay – mirroring is its own inverse). */
export const lineFromDisplay = lineToDisplay;

export function clubToDisplay(c: ClubEstimate | null | undefined, mirrored: boolean): ClubEstimate | null {
  if (!c) return null;
  if (!mirrored) return c;
  return { ...c, grip: mx(c.grip), head: mx(c.head), angleDeg: 180 - c.angleDeg };
}

/**
 * The infinite line through l.a, l.b clipped to the picture [0,1]² (normalized coordinates); null when it misses.
 * (Clipping in normalized coordinates is fine: the aspect scaling is linear.)
 */
export function clipLineToFrame(l: Line2): Line2 | null {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  let t0 = -Infinity;
  let t1 = Infinity;
  const clip = (p: number, q: number) => {
    // p·t ≤ q
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    return true;
  };
  if (!clip(-dx, l.a.x) || !clip(dx, 1 - l.a.x) || !clip(-dy, l.a.y) || !clip(dy, 1 - l.a.y) || t0 > t1) return null;
  return { a: { x: l.a.x + t0 * dx, y: l.a.y + t0 * dy }, b: { x: l.a.x + t1 * dx, y: l.a.y + t1 * dy } };
}

/** Two grab handles on the visible part of the line (25 % and 75 % along it). */
export function lineHandles(l: Line2): [Vec2, Vec2] | null {
  const c = clipLineToFrame(l);
  if (!c) return null;
  const at = (f: number): Vec2 => ({ x: c.a.x + (c.b.x - c.a.x) * f, y: c.a.y + (c.b.y - c.a.y) * f });
  return [at(0.25), at(0.75)];
}

export type LineGrab = 'a' | 'b' | 'move' | null;

/**
 * What did the finger hit? Points in CSS pixels of the overlay (w × h). Handles win over the line itself.
 */
export function hitLine(l: Line2, p: Vec2, w: number, h: number, handleR = 30, lineR = 24): LineGrab {
  const hs = lineHandles(l);
  if (!hs) return null;
  const px = (q: Vec2) => ({ x: q.x * w, y: q.y * h });
  const P = p;
  const [A, B] = hs.map(px);
  if (Math.hypot(P.x - A.x, P.y - A.y) <= handleR) return 'a';
  if (Math.hypot(P.x - B.x, P.y - B.y) <= handleR) return 'b';
  const c = clipLineToFrame(l)!;
  const C0 = px(c.a);
  const C1 = px(c.b);
  const dx = C1.x - C0.x;
  const dy = C1.y - C0.y;
  const L2 = dx * dx + dy * dy;
  const f = L2 > 0 ? Math.max(0, Math.min(1, ((P.x - C0.x) * dx + (P.y - C0.y) * dy) / L2)) : 0;
  const d = Math.hypot(P.x - (C0.x + f * dx), P.y - (C0.y + f * dy));
  return d <= lineR ? 'move' : null;
}

/**
 * Apply a drag (delta in normalized coordinates) to the line. Dragging a handle moves that handle (the line turns
 * around the other one); dragging the line moves it in parallel. The result is expressed by its two handles.
 */
export function dragLine(l: Line2, grab: Exclude<LineGrab, null>, d: Vec2): Line2 {
  const hs = lineHandles(l) ?? [l.a, l.b];
  let [a, b] = hs;
  if (grab === 'a' || grab === 'move') a = { x: a.x + d.x, y: a.y + d.y };
  if (grab === 'b' || grab === 'move') b = { x: b.x + d.x, y: b.y + d.y };
  // keep the handles apart so the line cannot collapse
  if (Math.hypot(a.x - b.x, a.y - b.y) < 0.02) return l;
  return { a, b };
}
