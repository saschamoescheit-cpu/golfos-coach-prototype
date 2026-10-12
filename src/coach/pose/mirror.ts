import type { Handedness, Landmark, PoseFrame, PoseSequence } from '../model/types';

/** Pairs of left/right landmark indices that swap places when mirroring (BlazePose order). */
const SWAP: [number, number][] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
  [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];
const PARTNER: number[] = Array.from({ length: 33 }, (_, i) => i);
for (const [a, b] of SWAP) {
  PARTNER[a] = b;
  PARTNER[b] = a;
}

/** Mirror one landmark list horizontally: x → 1 − x and left/right body points swapped. */
export function mirrorLandmarks(lm: Landmark[]): Landmark[] {
  return lm.map((_, i) => {
    const p = lm[PARTNER[i]];
    return { x: 1 - p.x, y: p.y, z: p.z, v: p.v };
  });
}

/** World landmarks are hip-centred (x right): mirror = negate x and swap sides. */
export function mirrorWorld(lm: Landmark[]): Landmark[] {
  return lm.map((_, i) => {
    const p = lm[PARTNER[i]];
    return { x: -p.x, y: p.y, z: p.z, v: p.v };
  });
}

export function mirrorFrame(f: PoseFrame): PoseFrame {
  return {
    t: f.t,
    lm: f.lm ? mirrorLandmarks(f.lm) : null,
    world: f.world ? mirrorWorld(f.world) : f.world,
  };
}

/**
 * Bring a sequence into the canonical right-handed frame. Left-handed swings are mirrored; calling it twice
 * with the same handedness is a no-op thanks to the `mirrored` flag.
 */
export function toCanonical(seq: PoseSequence, handedness: Handedness): PoseSequence {
  const want = handedness === 'left';
  if (seq.mirrored === want) return seq;
  return { ...seq, mirrored: want, frames: seq.frames.map(mirrorFrame) };
}

/** Undo the canonical mirroring, e.g. to draw an overlay on top of the original (unmirrored) video. */
export function toDisplay(seq: PoseSequence): PoseSequence {
  if (!seq.mirrored) return seq;
  return { ...seq, mirrored: false, frames: seq.frames.map(mirrorFrame) };
}
