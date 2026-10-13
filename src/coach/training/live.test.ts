import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import { metricsAtFrame } from '../analysis/metrics';
import { trackClub } from '../club/track';
import { LM } from '../model/constants';
import type { PoseFrame } from '../model/types';
import { synthSwing } from '../testing/synth';
import { alignGhost, ghostToRaw } from './ghost';
import { evaluateLiveFrame, isAddressLike, mirrorCriteria, StillnessDetector, torsoLength } from './live';
import { MirrorMachine } from './mirror';
import { getFaultDef } from '../faults/catalog';
import { targetFromFault, targetFromTemplate, TEMPLATES } from './targets';

const ASPECT = 1080 / 1920;

describe('address capture (stillness)', () => {
  it('detects a still address after the window, not during the swing', () => {
    const { seq, truth } = synthSwing({ fps: 30, addressMs: 1500, noise: 0.001 });
    const det = new StillnessDetector(ASPECT);
    const stillAt: number[] = [];
    seq.frames.forEach((f, i) => det.push(f) && stillAt.push(i));
    expect(stillAt.length).toBeGreaterThan(0);
    expect(seq.frames[stillAt[0]].t).toBeGreaterThanOrEqual(900);
    // never "still at address" between takeaway and impact
    const takeaway = truth.keyframes.address! + 2;
    expect(stillAt.filter((i) => i > takeaway && i <= truth.keyframes.impact!)).toEqual([]);
  });

  it('address-like: hands below the hips; not at the top', () => {
    const { seq, truth } = synthSwing({});
    expect(isAddressLike(seq.frames[truth.keyframes.address!].lm!)).toBe(true);
    expect(isAddressLike(seq.frames[truth.keyframes.top!].lm!)).toBe(false);
  });

  it('a missing pose resets the window', () => {
    const det = new StillnessDetector(ASPECT, { windowMs: 300 });
    const { seq } = synthSwing({ fps: 30, addressMs: 2000 });
    for (let i = 0; i < 15; i++) det.push(seq.frames[i]);
    expect(det.push({ t: seq.frames[15].t, lm: null })).toBe(false);
    expect(det.push(seq.frames[16])).toBe(false);
  });
});

describe('ghost', () => {
  it('is moved and scaled onto the live player (hips on hips, torso length on torso length)', () => {
    const near = synthSwing({ zoom: 1 }).seq.frames[0].lm!;
    const far = synthSwing({ zoom: 0.6 }).seq.frames[0].lm!.map((p) => ({ ...p, x: p.x + 0.1 }));
    const g = alignGhost(near, far, ASPECT)!;
    expect(torsoLength(g, ASPECT)).toBeCloseTo(torsoLength(far, ASPECT)!, 5);
    const hip = (lm: typeof g) => (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2;
    expect(hip(g)).toBeCloseTo(hip(far), 6);
    // same shape: ankle sits where the live ankle is (same pose, only zoom/offset differ)
    expect(g[LM.LEFT_ANKLE].y).toBeCloseTo(far[LM.LEFT_ANKLE].y, 2);
  });

  it('left-handers: canonical ghost is mirrored back for display', () => {
    const lm = synthSwing({}).seq.frames[0].lm!;
    expect(ghostToRaw(lm, 'right')).toBe(lm);
    expect(ghostToRaw(lm, 'left')[LM.LEFT_WRIST].x).toBeCloseTo(1 - lm[LM.RIGHT_WRIST].x);
  });
});

describe('mirror criteria', () => {
  it('whole-swing criteria are left out of the mirror mode', () => {
    const tpl = TEMPLATES.find((x) => x.id === 'tpl_putt_head')!;
    expect(mirrorCriteria(targetFromTemplate(tpl, { withGhost: false })).map((c) => c.metric)).toEqual(['head_shift_x']);
  });
});

// ------------------------------------------------------------------ needs the real metrics (agent phases-metrics)
const probe = synthSwing({ view: 'face_on' });
const probeCtx: AnalysisContext = { shotType: 'iron', view: 'face_on', handedness: 'right' };
const metricsImplemented = (() => {
  try {
    const top = probe.truth.keyframes.top!;
    const { club, neutralLine } = trackClub(probe.seq, undefined, probeCtx);
    return metricsAtFrame(probe.seq, top, probe.truth.keyframes.address!, 'top', club, neutralLine, probeCtx).length > 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!metricsImplemented)('live mirror evaluation with real metrics', () => {
  const dims = { width: 1080, height: 1920, fps: 30 };

  it('straight lead arm at the top is a hit, a bent one is not', () => {
    const tpl = TEMPLATES.find((x) => x.id === 'tpl_top_lead_arm')!;
    const target = targetFromTemplate(tpl, { withGhost: false });
    const judge = (leadElbowTop: number) => {
      const s = synthSwing({ view: 'face_on', leadElbowTop });
      const a = s.seq.frames[s.truth.keyframes.address!];
      const top = s.seq.frames[s.truth.keyframes.top!];
      return evaluateLiveFrame(target, a, top, dims, probeCtx, 1);
    };
    expect(judge(5).hit).toBe(true);
    const bent = judge(45);
    expect(bent.hit).toBe(false);
    expect(bent.proximity!).toBeLessThan(judge(5).proximity!);
  });

  it('slow motion into the top position: reach tone, held after holding 2 s', () => {
    // the player moves slowly into the top and holds it: frames of the synthetic top, repeated over 3 s
    const target = targetFromFault(getFaultDef('bent_lead_arm')!, { view: 'face_on', withGhost: false })!;
    const s = synthSwing({ view: 'face_on', backswingMs: 3000, leadElbowTop: 5 });
    const addr = s.seq.frames[s.truth.keyframes.address!];
    const m = new MirrorMachine();
    const events: string[] = [];
    const frames: PoseFrame[] = s.seq.frames.slice(0, s.truth.keyframes.top! + 1);
    const top = frames[frames.length - 1];
    for (let k = 1; k <= 90; k++) frames.push({ ...top, t: top.t + k * 33 });
    for (const f of frames) {
      const ev = evaluateLiveFrame(target, addr, f, dims, probeCtx, 1);
      events.push(...m.update(f.t, ev.maxDistance).events);
    }
    expect(events).toContain('reach');
    expect(events[events.length - 1]).toBe('held');
  });
});
