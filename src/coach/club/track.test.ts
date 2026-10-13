import { describe, expect, it } from 'vitest';
import type { AnalysisContext } from '../analysis/context';
import type { CameraView, ClubEstimate, Handedness } from '../model/types';
import { toCanonical } from '../pose/mirror';
import { synthGrayFrame, synthSwing } from '../testing/synth';
import type { GrayImage } from './ClubProvider';
import { mirrorGray } from './image';
import {
  CLUB_MEASURED_MIN,
  findAddressStill,
  HANDS_MAX_CONFIDENCE,
  lineAngleDeg,
  mirrorClub,
  shaftVsNeutralDeg,
  trackClub,
  undirectedDiff,
} from './track';
import { angleErr, clubLenPx, pctl, visibleFraction } from './testutil';

const W = 203;
const H = 360;

function setup(view: CameraView, handedness: Handedness = 'right', extra: Record<string, unknown> = {}) {
  const s = synthSwing({ view, handedness, fps: 60, noise: 0.002, seed: 5, ...extra });
  const ctx: AnalysisContext = { view, handedness, shotType: s.params.shotType };
  // images of the canonical scene; a left-hander's video is the mirror image
  const canonImgs = s.truth.club.map((c, i) => synthGrayFrame(c, { width: W, height: H, noise: 10, seed: i + 1 }));
  const rawImgs = handedness === 'left' ? canonImgs.map(mirrorGray) : canonImgs;
  return { s, ctx, rawImgs };
}

/** as analyze.ts does: canonical landmarks and canonical (mirrored back) images */
function run(view: CameraView, handedness: Handedness = 'right', mutate?: (imgs: (GrayImage | undefined)[]) => void, extra: Record<string, unknown> = {}) {
  const { s, ctx, rawImgs } = setup(view, handedness, extra);
  const imgs: (GrayImage | undefined)[] = [...rawImgs];
  mutate?.(imgs);
  const seq = toCanonical(s.seq, handedness);
  const canon = handedness === 'left' ? imgs.map((im) => (im ? mirrorGray(im) : undefined)) : imgs;
  const t0 = performance.now();
  const track = trackClub(seq, canon, ctx);
  const ms = performance.now() - t0;
  return { s, seq, track, ms };
}

function clean(s: ReturnType<typeof synthSwing>): number[] {
  const aspect = s.seq.width / s.seq.height;
  const lens = s.truth.club.map((c) => clubLenPx(c, aspect));
  const max = Math.max(...lens);
  return lens.map((l, i) => (l >= 0.5 * max && visibleFraction(s.truth.club[i]) >= 0.6 ? i : -1)).filter((i) => i >= 0);
}

describe('trackClub through a whole synthetic swing', () => {
  const cases: [CameraView, Handedness][] = [
    ['down_the_line', 'right'],
    ['face_on', 'right'],
    ['down_the_line', 'left'],
    ['face_on', 'left'],
  ];
  for (const [view, hand] of cases) {
    it(`tracks the shaft (${view}, ${hand}-handed)`, () => {
      const { s, track, ms } = run(view, hand);
      expect(track.club.length).toBe(s.seq.frames.length);
      const idx = clean(s);
      const errs = idx.map((i) => angleErr(track.club[i], s.truth.club[i]));
      const imageShare = idx.filter((i) => track.club[i]?.source === 'image').length / idx.length;
      const confident = track.club.map((c, i) => (c && c.source === 'image' && c.confidence >= CLUB_MEASURED_MIN ? angleErr(c, s.truth.club[i]) : -1)).filter((e) => e >= 0);
      console.info(
        `[club] track ${view}/${hand}: frames=${s.seq.frames.length} clean=${idx.length} image=${(imageShare * 100).toFixed(0)}% ` +
          `median=${pctl(errs, 0.5).toFixed(2)}° p95=${pctl(errs, 0.95).toFixed(2)}° confidentMax=${Math.max(...confident).toFixed(2)}° ${ms.toFixed(0)} ms`,
      );
      expect(imageShare).toBeGreaterThan(0.95);
      expect(pctl(errs, 0.5)).toBeLessThanOrEqual(1);
      expect(pctl(errs, 0.95)).toBeLessThanOrEqual(3);
    });
  }

  it('gives the left-hander overlay on the original video via mirrorClub', () => {
    const { s, track } = run('down_the_line', 'left');
    const i = s.truth.keyframes.address!;
    const shown = mirrorClub(track.club[i]!);
    const truthShown = mirrorClub(s.truth.club[i]);
    expect(Math.abs(undirectedDiff(shown.angleDeg, truthShown.angleDeg))).toBeLessThan(2);
    expect(Math.abs(shown.grip.x - truthShown.grip.x)).toBeLessThan(0.03);
  });

  it('finds the neutral line at address within 1.5°', () => {
    for (const view of ['down_the_line', 'face_on'] as CameraView[]) {
      const { s, track } = run(view);
      const aspect = s.seq.width / s.seq.height;
      expect(track.neutralLine).not.toBeNull();
      const truth = s.truth.club[s.truth.keyframes.address!];
      const err = Math.abs(undirectedDiff(lineAngleDeg(track.neutralLine!, aspect), truth.angleDeg));
      console.info(`[club] neutral ${view}: err=${err.toFixed(2)}° frames=${track.addressFrames} conf=${track.neutralConfidence?.toFixed(2)}`);
      expect(err).toBeLessThan(1.5);
      // address stillness ends at the takeaway; down-the-line the first ~0.15 s of the takeaway move the hands
      // towards the camera only (invisible in 2D) – harmless, the shaft stays on the neutral line meanwhile
      expect(track.addressFrames![1]).toBeLessThanOrEqual(s.truth.keyframes.address! + (view === 'face_on' ? 3 : 9));
      expect(track.addressFrames![1]).toBeGreaterThanOrEqual(s.truth.keyframes.address! - 6);
      expect(track.neutralConfidence).toBeGreaterThan(0.5);
    }
  });

  it('interpolates short gaps (missing images) from the neighbouring detections', () => {
    const gapStart = 76; // downswing-like straight rotation in the backswing at 60 fps (address ends at frame 41), shaft inside the picture face-on
    const { s, track } = run('face_on', 'right', (imgs) => {
      for (let k = 0; k < 3; k++) imgs[gapStart + k] = undefined;
    });
    for (let k = 0; k < 3; k++) {
      const c = track.club[gapStart + k]!;
      expect(c.source).toBe('image');
      expect(angleErr(c, s.truth.club[gapStart + k])).toBeLessThan(3);
    }
  });

  it('keeps the hand estimate over long gaps', () => {
    const { track } = run('down_the_line', 'right', (imgs) => {
      for (let k = 0; k < 20; k++) imgs[60 + k] = undefined;
    });
    expect(track.club[70]!.source).toBe('hands');
    expect(track.club[70]!.confidence).toBeLessThanOrEqual(HANDS_MAX_CONFIDENCE);
  });

  it('falls back to the hands without images – estimated, never measured, no neutral line', () => {
    const s = synthSwing({ view: 'down_the_line', fps: 60 });
    const track = trackClub(s.seq, undefined, { view: 'down_the_line', handedness: 'right', shotType: 'iron' });
    expect(track.club.every((c) => c && c.source === 'hands' && c.confidence <= HANDS_MAX_CONFIDENCE)).toBe(true);
    expect(track.neutralLine).toBeNull();
    expect(track.imageRatio).toBe(0);
    const idx = clean(s);
    const errs = idx.map((i) => angleErr(track.club[i], s.truth.club[i]));
    console.info(`[club] hands-only track: median=${pctl(errs, 0.5).toFixed(1)}° p90=${pctl(errs, 0.9).toFixed(1)}°`);
  });

  it('uses the hands when the images show no shaft', () => {
    const s = synthSwing({ view: 'face_on', fps: 30 });
    const imgs = s.seq.frames.map((_, i) => synthGrayFrame(null, { width: W, height: H, noise: 20, seed: i }));
    const track = trackClub(s.seq, imgs, { view: 'face_on', handedness: 'right', shotType: 'iron' });
    const sources = new Set(track.club.map((c) => c?.source));
    expect(sources.has('image')).toBe(false);
    expect(track.neutralLine).toBeNull();
  });

  it('skips frames without a person', () => {
    const s = synthSwing({ view: 'face_on', fps: 30, dropout: 0.2, seed: 9 });
    const track = trackClub(s.seq, undefined, { view: 'face_on', handedness: 'right', shotType: 'iron' });
    s.seq.frames.forEach((f, i) => {
      if (!f.lm) expect(track.club[i]).toBeNull();
    });
  });

  it('measures steep (+) and flat (−) against the neutral line (DTL)', () => {
    // In DTL an on-plane shaft always lies on the neutral line (the plane is seen edge-on); the synthetic plane
    // deviation rotates the shaft about the vertical near the 9 o'clock positions (+ = club head outside = steep).
    for (const dev of [15, -15]) {
      const r = run('down_the_line', 'right', undefined, { shaftPlaneDevBack: dev, shaftPlaneDevDown: dev });
      const aspect = r.s.seq.width / r.s.seq.height;
      const truthNeutral = { a: r.s.truth.club[0].head, b: r.s.truth.club[0].grip };
      let checked = 0;
      const lines: string[] = [];
      r.track.club.forEach((c, k) => {
        const truthVal = shaftVsNeutralDeg(r.s.truth.club[k], truthNeutral, aspect);
        if (!c || c.source !== 'image' || c.confidence < CLUB_MEASURED_MIN || Math.abs(truthVal) < 5) return;
        const v = shaftVsNeutralDeg(c, r.track.neutralLine!, aspect);
        lines.push(`${k}:${v.toFixed(1)}/${truthVal.toFixed(1)}`);
        expect(Math.sign(v)).toBe(Math.sign(dev));
        expect(Math.abs(v - truthVal)).toBeLessThan(4);
        checked++;
      });
      console.info(`[club] plane dev ${dev}: measured/truth ${lines.join(' ')}`);
      expect(checked).toBeGreaterThan(0);
    }
    // on-plane swing: every measured frame lies on the neutral line
    const base = run('down_the_line');
    const aspect = base.s.seq.width / base.s.seq.height;
    const devs = base.track.club
      .filter((c): c is ClubEstimate => !!c && c.source === 'image' && c.confidence >= CLUB_MEASURED_MIN)
      .map((c) => Math.abs(shaftVsNeutralDeg(c, base.track.neutralLine!, aspect)));
    expect(pctl(devs, 0.95)).toBeLessThan(2);
  });

  it('finds the address stillness from the hand speed', () => {
    const s = synthSwing({ view: 'face_on', fps: 60, addressMs: 1200 });
    const r = findAddressStill(s.seq)!;
    expect(r).not.toBeNull();
    expect(r[1] - r[0] + 1).toBe(30); // 0.5 s window
    expect(Math.abs(r[1] - s.truth.keyframes.address!)).toBeLessThanOrEqual(3);
  });
});
