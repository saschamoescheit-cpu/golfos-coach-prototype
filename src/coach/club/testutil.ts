/** Test helpers for the club detector (synthetic distractors). Not used by the app. */
import type { ClubEstimate, Vec2 } from '../model/types';
import { undirectedDiff } from './lines';
import type { GrayImage } from './ClubProvider';

/** Draw a straight line (normalized coordinates) of given value and width in px into a copy of the image. */
export function drawLine(img: GrayImage, a: Vec2, b: Vec2, value: number, widthPx = 3): GrayImage {
  const out = { ...img, data: new Uint8ClampedArray(img.data) };
  const x0 = a.x * img.width;
  const y0 = a.y * img.height;
  const x1 = b.x * img.width;
  const y1 = b.y * img.height;
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  const r = (widthPx - 1) / 2;
  for (let s = 0; s <= n; s++) {
    const x = x0 + ((x1 - x0) * s) / n;
    const y = y0 + ((y1 - y0) * s) / n;
    for (let py = Math.round(y - r); py <= Math.round(y + r); py++)
      for (let px = Math.round(x - r); px <= Math.round(x + r); px++)
        if (px >= 0 && py >= 0 && px < img.width && py < img.height) out.data[py * img.width + px] = value;
  }
  return out;
}

/** Fill a thick segment (capsule) – a body part with step edges (e.g. a leg in dark trousers). */
export function fillCapsule(img: GrayImage, a: Vec2, b: Vec2, radiusPx: number, value: number): GrayImage {
  const out = { ...img, data: new Uint8ClampedArray(img.data) };
  const ax = a.x * img.width;
  const ay = a.y * img.height;
  const dx = b.x * img.width - ax;
  const dy = b.y * img.height - ay;
  const l2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= radiusPx) out.data[y * img.width + x] = value;
    }
  return out;
}

/** Box blur along one direction (motion blur of length px). */
export function motionBlur(img: GrayImage, dirDeg: number, lengthPx: number): GrayImage {
  const out = { ...img, data: new Uint8ClampedArray(img.data.length) };
  const ux = Math.cos((dirDeg * Math.PI) / 180);
  const uy = Math.sin((dirDeg * Math.PI) / 180);
  const n = Math.max(1, Math.round(lengthPx));
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      let s = 0;
      let c = 0;
      for (let k = 0; k < n; k++) {
        const px = Math.round(x + ux * (k - (n - 1) / 2));
        const py = Math.round(y + uy * (k - (n - 1) / 2));
        if (px >= 0 && py >= 0 && px < img.width && py < img.height) {
          s += img.data[py * img.width + px];
          c++;
        }
      }
      out.data[y * img.width + x] = c ? s / c : 0;
    }
  return out;
}

/** Projected shaft length in pixel space (normalized height units). */
export function clubLenPx(c: ClubEstimate, aspect: number): number {
  return Math.hypot((c.head.x - c.grip.x) * aspect, c.head.y - c.grip.y);
}

export function angleErr(a: ClubEstimate | null | undefined, truth: ClubEstimate): number {
  return a ? Math.abs(undirectedDiff(a.angleDeg, truth.angleDeg)) : Infinity;
}

export function pctl(values: number[], p: number): number {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
}

/** Share of the shaft (grip → head) that lies inside the image. */
export function visibleFraction(c: ClubEstimate): number {
  let inside = 0;
  const n = 50;
  for (let k = 0; k <= n; k++) {
    const x = c.grip.x + ((c.head.x - c.grip.x) * k) / n;
    const y = c.grip.y + ((c.head.y - c.grip.y) * k) / n;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) inside++;
  }
  return inside / (n + 1);
}
