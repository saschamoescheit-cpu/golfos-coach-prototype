import { describe, expect, it } from 'vitest';
import { ALL_SHOT_TYPES, ALL_VIEWS, LANDMARK_COUNT, SHOT_TYPES } from '../model/constants';
import { synthSwing } from '../testing/synth';
import ghostsJson from './ghosts.json';
import { ghostKey, modelGhost, type GhostTable } from './modelGhost';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function build(): GhostTable {
  const out: GhostTable = {};
  for (const shot of ALL_SHOT_TYPES)
    for (const view of ALL_VIEWS) {
      const { seq, truth } = synthSwing({ shotType: shot, view, fps: 30 });
      for (const pos of SHOT_TYPES[shot].positions) {
        const i = truth.keyframes[pos];
        const lm = i == null ? null : seq.frames[i]?.lm;
        if (lm) out[ghostKey(shot, view, pos)] = lm.map((p) => [r3(p.x), r3(p.y)]);
      }
    }
  return out;
}

describe('model ghosts (precomputed)', () => {
  it('ghosts.json matches the synthetic model swing', async () => {
    const fresh = build();
    const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    if (env.UPDATE_GHOSTS) {
      // no @types/node in this project → untyped dynamic imports
      const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, s: string): void };
      const url = (await import(/* @vite-ignore */ 'node:url' as string)) as { fileURLToPath(u: URL): string };
      fs.writeFileSync(url.fileURLToPath(new URL('./ghosts.json', import.meta.url)), JSON.stringify(fresh));
      return;
    }
    expect(ghostsJson).toEqual(fresh);
  });

  it('every shot/view/position has a full ghost', () => {
    for (const shot of ALL_SHOT_TYPES)
      for (const view of ALL_VIEWS)
        for (const pos of SHOT_TYPES[shot].positions) expect(modelGhost(shot, view, pos)?.length, `${shot} ${view} ${pos}`).toBe(LANDMARK_COUNT);
    expect(modelGhost('putt', 'face_on', 'backswing9')).toBeNull();
  });
});
