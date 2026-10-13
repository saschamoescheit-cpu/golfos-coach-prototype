import { SHOT_TYPES } from '../model/constants';
import type { CameraView, KeyPosition, Landmark, ShotType } from '../model/types';
import ghostsJson from './ghosts.json';

/**
 * Model-swing ghosts: the canonical pose of the synthetic ideal swing (testing/synth.ts, 30 fps, no noise) at each key
 * position, precomputed into ghosts.json so the app bundle does not need the generator.
 * Regenerate: `UPDATE_GHOSTS=1 npx vitest run src/coach/training/modelGhost.test.ts` (the test fails when the file is stale).
 * Format: { "<shotType>|<view>|<position>": [[x, y], … 33 points] } (3 decimals; z = 0, v = 1).
 */
export type GhostTable = Record<string, [number, number][]>;
const TABLE = ghostsJson as unknown as GhostTable;

export const ghostKey = (shotType: ShotType, view: CameraView, position: KeyPosition) => `${shotType}|${view}|${position}`;

export function modelGhost(shotType: ShotType, view: CameraView, position: KeyPosition): Landmark[] | null {
  if (!SHOT_TYPES[shotType].positions.includes(position)) return null;
  const pts = TABLE[ghostKey(shotType, view, position)];
  return pts ? pts.map(([x, y]) => ({ x, y, z: 0, v: 1 })) : null;
}
