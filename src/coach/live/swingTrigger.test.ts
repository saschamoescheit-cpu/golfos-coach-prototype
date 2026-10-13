import { describe, expect, it } from 'vitest';
import type { CameraView, PoseFrame, ShotType } from '../model/types';
import { mirrorFrame } from '../pose/mirror';
import { synthSwing, type SynthParams } from '../testing/synth';
import { SwingTrigger, type TriggerEvent } from './swingTrigger';

interface Truth {
  takeawayT: number;
  topT: number;
  impactT: number;
  finishT: number;
}

/** Build a live stream: several synthetic swings in a row (canonical frames), optional gaps without a person. */
function stream(swings: Partial<SynthParams>[], opts: { fps?: number; gapMs?: number; leadMs?: number; world?: boolean } = {}) {
  const fps = opts.fps ?? 30;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  // world landmarks with ±1.5 cm jitter (MediaPipe world output is noisier than this; first guess)
  const jitter = (w: PoseFrame["world"]) => (w ? w.map((p) => ({ ...p, x: p.x + rnd() * 0.015, y: p.y + rnd() * 0.015, z: p.z + rnd() * 0.03 })) : w);
  const frames: PoseFrame[] = [];
  const truths: Truth[] = [];
  let t0 = 0;
  const pushNull = (ms: number) => {
    const n = Math.round((ms * fps) / 1000);
    for (let i = 0; i < n; i++) frames.push({ t: t0 + (i * 1000) / fps, lm: null });
    t0 += (n * 1000) / fps;
  };
  if (opts.leadMs) pushNull(opts.leadMs);
  for (const p of swings) {
    const s = synthSwing({ fps, addressMs: 1500, finishHoldMs: 1500, ...p });
    const P = s.params;
    for (const f of s.seq.frames) {
      const c = P.handedness === 'left' && f.lm ? mirrorFrame(f) : f;
      frames.push({ t: t0 + f.t, lm: c.lm, world: opts.world === false ? undefined : jitter(c.world) });
    }
    truths.push({
      takeawayT: t0 + P.addressMs,
      topT: t0 + P.addressMs + P.backswingMs,
      impactT: t0 + P.addressMs + P.backswingMs + P.downswingMs,
      finishT: t0 + P.addressMs + P.backswingMs + P.downswingMs + P.followMs,
    });
    t0 = frames[frames.length - 1].t + 1000 / fps;
    if (opts.gapMs) pushNull(opts.gapMs);
  }
  return { frames, truths };
}

function feed(trigger: SwingTrigger, frames: PoseFrame[]): TriggerEvent[] {
  return frames.flatMap((f) => trigger.push(f));
}
const swingsOf = (ev: TriggerEvent[]) => ev.filter((e): e is Extract<TriggerEvent, { type: 'swing' }> => e.type === 'swing');

describe('SwingTrigger', () => {
  it('range series: five swings in a row → exactly five events with accurate timing', () => {
    const { frames, truths } = stream(
      [1, 2, 3, 4, 5].map((seed) => ({ shotType: 'iron' as ShotType, noise: 0.003, seed })),
    );
    const tr = new SwingTrigger({ shotType: 'iron', view: 'face_on' });
    const ev = feed(tr, frames);
    const sw = swingsOf(ev);
    expect(sw.length).toBe(5);
    sw.forEach((e, i) => {
      const tt = truths[i];
      expect(e.practice).toBe(false);
      expect(Math.abs(e.impactT! - tt.impactT)).toBeLessThanOrEqual(100);
      expect(Math.abs(e.topT! - tt.topT)).toBeLessThanOrEqual(150);
      expect(e.startT).toBeLessThanOrEqual(tt.takeawayT - 500);
      expect(e.endT).toBeGreaterThanOrEqual(tt.finishT);
    });
    expect(ev.filter((e) => e.type === 'impact').length).toBe(5);
    expect(ev[0].type).toBe('player');
  });

  const cases: [ShotType, CameraView][] = [];
  for (const s of ['driver', 'iron', 'bunker', 'pitch', 'chip', 'putt'] as ShotType[]) for (const v of ['face_on', 'down_the_line'] as CameraView[]) cases.push([s, v]);
  for (const fps of [15, 30])
    for (const [shotType, view] of cases)
      it(`${shotType} ${view} at ${fps} fps: one swing, impact within 100 ms`, () => {
        const { frames, truths } = stream([{ shotType, view, noise: 0.003, seed: 7 }, { shotType, view, noise: 0.003, seed: 8 }], { fps });
        const sw = swingsOf(feed(new SwingTrigger({ shotType, view }), frames));
        expect(sw.length).toBe(2);
        sw.forEach((e, i) => {
          expect(Math.abs(e.impactT! - truths[i].impactT)).toBeLessThanOrEqual(100);
          expect(e.practice).toBe(false);
        });
      });

  // putt and chip move the hands mostly along the camera axis down-the-line → they need world landmarks
  for (const shotType of ['driver', 'iron', 'pitch'] as ShotType[])
    it(`down-the-line without world landmarks (image only): ${shotType}`, () => {
      const { frames, truths } = stream([{ shotType, view: 'down_the_line', noise: 0.002, seed: 3 }], { world: false });
      const sw = swingsOf(feed(new SwingTrigger({ shotType, view: 'down_the_line' }), frames));
      expect(sw.length).toBe(1);
      expect(Math.abs(sw[0].impactT! - truths[0].impactT)).toBeLessThanOrEqual(100);
    });

  it('left-handed player (frames mirrored to canonical) works the same', () => {
    const { frames, truths } = stream([{ handedness: 'left', noise: 0.003 }]);
    const sw = swingsOf(feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames));
    expect(sw.length).toBe(1);
    expect(Math.abs(sw[0].impactT! - truths[0].impactT)).toBeLessThanOrEqual(100);
  });

  it('player walks off between swings → lost, player, address again; re-arms', () => {
    const { frames } = stream([{ seed: 1 }, { seed: 2 }, { seed: 3 }], { gapMs: 2000, leadMs: 1000 });
    const ev = feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames);
    expect(swingsOf(ev).length).toBe(3);
    expect(ev.filter((e) => e.type === 'lost').length).toBe(3);
    expect(ev.filter((e) => e.type === 'player').length).toBe(3);
    expect(ev.filter((e) => e.type === 'address').length).toBeGreaterThanOrEqual(3);
  });

  it('short address (no still set-up of 1 s) → practice swing', () => {
    const { frames } = stream([{ addressMs: 600, noise: 0.002 }]);
    const sw = swingsOf(feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames));
    expect(sw.length).toBe(1);
    expect(sw[0].practice).toBe(true);
  });

  it('waggle-sized swing on a full-swing setting → practice swing', () => {
    const { frames } = stream([{ shotType: 'chip', noise: 0.002 }]);
    const sw = swingsOf(feed(new SwingTrigger({ shotType: 'driver', view: 'face_on' }), frames));
    expect(sw.length).toBe(1);
    expect(sw[0].practice).toBe(true);
  });

  it('standing still at address → address event but no swing', () => {
    const s = synthSwing({ fps: 30, addressMs: 6000, backswingMs: 1, downswingMs: 1, followMs: 1, finishHoldMs: 0, noise: 0.003 });
    const frames = s.seq.frames.filter((f) => f.t < 5900);
    const ev = feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames);
    expect(ev.map((e) => e.type)).toEqual(['player', 'address']);
  });

  it('waggles at address do not fire', () => {
    const s = synthSwing({ fps: 30, addressMs: 8000, noise: 0.002 });
    const frames = s.seq.frames
      .filter((f) => f.t < 7900)
      .map((f) => ({
        ...f,
        lm: f.lm!.map((p, i) => (i >= 15 && i <= 22 ? { ...p, x: p.x + 0.02 * Math.sin(f.t / 120) } : p)),
      }));
    const ev = feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames);
    expect(swingsOf(ev).length).toBe(0);
  });

  it('slow rehearsal (down as slow as up) is not a swing', () => {
    const { frames } = stream([{ backswingMs: 800, downswingMs: 900, noise: 0.002 }]);
    const ev = feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), frames);
    expect(swingsOf(ev).length).toBe(0);
  });

  it('short dropouts around impact (motion blur) do not break detection', () => {
    const { frames, truths } = stream([{ noise: 0.003 }]);
    const imp = truths[0].impactT;
    const holed = frames.map((f) => (Math.abs(f.t - imp) < 80 ? { ...f, lm: null } : f));
    const sw = swingsOf(feed(new SwingTrigger({ shotType: 'iron', view: 'face_on' }), holed));
    expect(sw.length).toBe(1);
    expect(Math.abs(sw[0].impactT! - imp)).toBeLessThanOrEqual(100);
  });

  it('flush() emits a pending swing (camera stopped during post-roll)', () => {
    const { frames, truths } = stream([{}]);
    const tr = new SwingTrigger({ shotType: 'iron', view: 'face_on' });
    const cut = frames.filter((f) => f.t < truths[0].impactT + 200);
    expect(swingsOf(feed(tr, cut)).length).toBe(0);
    expect(tr.state).toBe('follow');
    expect(swingsOf(tr.flush()).length).toBe(1);
    expect(tr.flush()).toEqual([]);
  });
});
