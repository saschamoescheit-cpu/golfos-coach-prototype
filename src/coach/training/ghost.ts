import { LM } from '../model/constants';
import type { Handedness, Landmark } from '../model/types';
import { mirrorLandmarks } from '../pose/mirror';
import { torsoLength } from './live';

/**
 * Ghost = the target pose drawn half-transparent over the live picture (US-1.9). Target landmarks are canonical
 * (right-handed); the live picture is raw camera coordinates. The ghost is moved and scaled onto the player:
 * hip centre on hip centre, torso length on torso length – so it does not matter where the player stands.
 */
export function ghostToRaw(ghost: Landmark[], handedness: Handedness): Landmark[] {
  return handedness === 'left' ? mirrorLandmarks(ghost) : ghost;
}

function hipMid(lm: Landmark[]) {
  return { x: (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2, y: (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2 };
}

/**
 * Align ghost onto the live pose (both in the same orientation, normalized image coordinates).
 * `aspect` = width / height of the picture (scaling happens in pixel space so the figure keeps its shape).
 * Returns null when either pose lacks hips/shoulders.
 */
export function alignGhost(ghost: Landmark[], live: Landmark[], aspect: number): Landmark[] | null {
  const tg = torsoLength(ghost, aspect);
  const tl = torsoLength(live, aspect);
  if (!tg || !tl) return null;
  const s = tl / tg;
  const g0 = hipMid(ghost);
  const l0 = hipMid(live);
  return ghost.map((p) => ({
    x: l0.x + ((p.x - g0.x) * aspect * s) / aspect,
    y: l0.y + (p.y - g0.y) * s,
    z: p.z,
    v: p.v,
  }));
}
