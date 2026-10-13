import { describe, expect, it } from 'vitest';
import { TONES, TrainingAudio, VIBRATION, type ToneKind } from './audio';

const mean = (k: ToneKind) => TONES[k].reduce((s, n) => s + (n.f0 + n.f1) / 2, 0) / TONES[k].length;
const length = (k: ToneKind) => Math.max(...TONES[k].map((n) => n.at + n.dur));

describe('training tones', () => {
  it('hit and miss are clearly different: high & rising vs. low & falling, different rhythm and timbre', () => {
    expect(mean('hit')).toBeGreaterThan(4 * mean('miss'));
    const hit = TONES.hit;
    expect(hit[hit.length - 1].f0).toBeGreaterThan(hit[0].f0); // rising
    expect(TONES.miss[0].f1).toBeLessThan(TONES.miss[0].f0); // falling
    expect(hit.length).not.toBe(TONES.miss.length);
    expect(TONES.miss[0].wave).not.toBe(hit[0].wave);
  });

  it('reach and held differ (one blip vs. three rising notes); all tones are short (no continuous tone)', () => {
    expect(TONES.reach.length).toBe(1);
    expect(TONES.held.length).toBe(3);
    for (const k of Object.keys(TONES) as ToneKind[]) {
      expect(length(k)).toBeLessThan(0.6);
      expect(VIBRATION[k].length).toBeGreaterThan(0);
      for (const n of TONES[k]) expect(n.gain).toBeLessThanOrEqual(1);
    }
  });

  it('without an unlocked AudioContext (Node, or before the first tap) play() is a silent no-op', async () => {
    const a = new TrainingAudio();
    expect(a.unlocked).toBe(false);
    expect(() => a.play('hit')).not.toThrow();
    expect(await a.unlock()).toBe(false);
  });
});
