import { describe, expect, it } from 'vitest';
import { LM } from '../model/constants';
import type { CameraView, ClubEstimate } from '../model/types';
import { synthGrayFrame, synthSwing } from '../testing/synth';
import type { ClubFrameInput, GrayImage } from './ClubProvider';
import { HandClubProvider, HANDS_MAX_CONFIDENCE } from './hands';
import { detectShaft, ImageShaftProvider } from './shaft';
import { CLUB_MEASURED_MIN } from './lines';
import { angleErr, clubLenPx, drawLine, fillCapsule, motionBlur, pctl, visibleFraction } from './testutil';

const W = 203;
const H = 360;

function swing(view: CameraView, extra: Record<string, unknown> = {}) {
  return synthSwing({ view, fps: 30, ...extra });
}

/**
 * Frames whose true shaft is long enough in the image to define an angle (not pointing at the camera) and at least
 * 60 % inside the picture ("clean"). With `clipped` also the frames where the shaft mostly leaves the picture.
 */
function usableFrames(s: ReturnType<typeof swing>, clipped = false): number[] {
  const aspect = s.seq.width / s.seq.height;
  const lens = s.truth.club.map((c) => clubLenPx(c, aspect));
  const max = Math.max(...lens);
  return lens
    .map((l, i) => (l >= 0.5 * max && (clipped || visibleFraction(s.truth.club[i]) >= 0.6) ? i : -1))
    .filter((i) => i >= 0);
}

function input(s: ReturnType<typeof swing>, i: number, image: GrayImage | undefined, prev?: ClubEstimate | null): ClubFrameInput {
  return { lm: s.seq.frames[i].lm, image, aspect: s.seq.width / s.seq.height, prev, view: s.params.view, shotType: s.params.shotType };
}

const provider = new ImageShaftProvider();

function errors(s: ReturnType<typeof swing>, img: (c: ClubEstimate, i: number) => GrayImage) {
  const errs: number[] = [];
  let misses = 0;
  for (const i of usableFrames(s)) {
    const est = provider.estimate(input(s, i, img(s.truth.club[i], i)));
    if (!est) misses++;
    else errs.push(angleErr(est, s.truth.club[i]));
  }
  return { errs, misses, n: errs.length + misses };
}

describe('ImageShaftProvider', () => {
  for (const view of ['face_on', 'down_the_line'] as CameraView[]) {
    it(`finds the shaft on clean frames within 3° (${view})`, () => {
      const s = swing(view);
      const r = errors(s, (c) => synthGrayFrame(c, { width: W, height: H }));
      console.info(`[club] clean ${view}: n=${r.n} misses=${r.misses} max=${Math.max(...r.errs).toFixed(2)}° p90=${pctl(r.errs, 0.9).toFixed(2)}°`);
      expect(r.misses).toBe(0);
      expect(Math.max(...r.errs)).toBeLessThanOrEqual(3);
    });
  }

  it('every confident estimate is accurate, also when the shaft leaves the picture', () => {
    for (const view of ['face_on', 'down_the_line'] as CameraView[]) {
      const s = swing(view);
      let confident = 0;
      let worst = 0;
      let all = 0;
      for (const i of usableFrames(s, true)) {
        all++;
        const est = provider.estimate(input(s, i, synthGrayFrame(s.truth.club[i], { width: W, height: H })));
        if (est && est.confidence >= CLUB_MEASURED_MIN) {
          confident++;
          worst = Math.max(worst, angleErr(est, s.truth.club[i]));
        }
      }
      console.info(`[club] confident ${view}: ${confident}/${all} worst=${worst.toFixed(2)}°`);
      expect(worst).toBeLessThanOrEqual(3);
    }
  });

  it('works for both polarities (bright shaft on dark ground)', () => {
    const s = swing('down_the_line');
    const r = errors(s, (c) => synthGrayFrame(c, { width: W, height: H, background: 45, shaft: 200 }));
    console.info(`[club] bright: n=${r.n} misses=${r.misses} max=${Math.max(...r.errs).toFixed(2)}°`);
    expect(r.misses).toBe(0);
    expect(Math.max(...r.errs)).toBeLessThanOrEqual(3);
  });

  it('is robust with pixel noise and low contrast', () => {
    const s = swing('face_on');
    const r = errors(s, (c, i) => synthGrayFrame(c, { width: W, height: H, background: 150, shaft: 80, noise: 25, seed: i + 1 }));
    console.info(`[club] noise: n=${r.n} misses=${r.misses} median=${pctl(r.errs, 0.5).toFixed(2)}° p90=${pctl(r.errs, 0.9).toFixed(2)}°`);
    expect(r.misses / r.n).toBeLessThan(0.1);
    expect(pctl(r.errs, 0.9)).toBeLessThanOrEqual(3);
  });

  it('handles motion blur (wide, faint shaft)', () => {
    const s = swing('face_on');
    const r = errors(s, (c) => motionBlur(synthGrayFrame(c, { width: W, height: H }), c.angleDeg + 90, 4));
    console.info(`[club] blur: n=${r.n} misses=${r.misses} p90=${pctl(r.errs, 0.9).toFixed(2)}°`);
    expect(r.misses / r.n).toBeLessThan(0.1);
    expect(pctl(r.errs, 0.9)).toBeLessThanOrEqual(3);
  });

  it('ignores an alignment stick on the ground and body edges / arm gap', () => {
    for (const view of ['face_on', 'down_the_line'] as CameraView[]) {
      const s = swing(view);
      const r = errors(s, (c, i) => {
        const lm = s.seq.frames[i].lm!;
        let img = synthGrayFrame(c, { width: W, height: H });
        // dark trousers: legs as filled capsules (step edges), drawn first, the shaft on top
        img = fillCapsule(img, lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], 9, 90);
        img = fillCapsule(img, lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE], 7, 90);
        img = fillCapsule(img, lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], 9, 90);
        img = fillCapsule(img, lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE], 7, 90);
        // alignment stick on the ground in front of the feet
        img = view === 'face_on' ? drawLine(img, { x: 0.05, y: 0.93 }, { x: 0.95, y: 0.95 }, 30, 3) : drawLine(img, { x: 0.3, y: 0.99 }, { x: 0.7, y: 0.86 }, 30, 3);
        // dark gap along the lead forearm (between the arms) – a thin line starting at the hands
        img = drawLine(img, lm[LM.LEFT_ELBOW], lm[LM.LEFT_WRIST], 30, 2);
        const shaft = synthGrayFrame(c, { width: W, height: H, background: 255 });
        for (let k = 0; k < img.data.length; k++) if (shaft.data[k] < 255) img.data[k] = shaft.data[k];
        return img;
      });
      console.info(`[club] distractors ${view}: n=${r.n} misses=${r.misses} p90=${pctl(r.errs, 0.9).toFixed(2)}° max=${Math.max(...r.errs).toFixed(1)}°`);
      expect(r.misses / r.n).toBeLessThan(0.1);
      expect(pctl(r.errs, 0.9)).toBeLessThanOrEqual(3);
    }
  });

  it('returns null or low confidence when no shaft is drawn', () => {
    const s = swing('face_on');
    let maxConf = 0;
    for (const i of usableFrames(s)) {
      for (const img of [synthGrayFrame(null, { width: W, height: H }), synthGrayFrame(null, { width: W, height: H, noise: 25, seed: i })]) {
        const est = provider.estimate(input(s, i, img));
        maxConf = Math.max(maxConf, est?.confidence ?? 0);
      }
    }
    console.info(`[club] empty frames: max confidence=${maxConf.toFixed(2)}`);
    expect(maxConf).toBeLessThan(0.3);
  });

  it('returns null without image or landmarks', () => {
    const s = swing('face_on');
    expect(provider.estimate(input(s, 0, undefined))).toBeNull();
    expect(provider.estimate({ ...input(s, 0, synthGrayFrame(s.truth.club[0])), lm: null })).toBeNull();
  });

  it('reports visible length and polarity', () => {
    const s = swing('down_the_line');
    const det = detectShaft(input(s, 0, synthGrayFrame(s.truth.club[0], { width: W, height: H })));
    expect(det?.polarity).toBe('dark');
    const truthLen = clubLenPx(s.truth.club[0], W / H) * H;
    // from the hand centre to the head ≈ club length minus the grip part
    expect(det!.lengthPx).toBeGreaterThan(0.75 * truthLen);
    expect(det!.lengthPx).toBeLessThan(1.1 * truthLen);
  });
});

describe('HandClubProvider (fallback)', () => {
  it('estimates from the arms with source hands and confidence ≤ 0.4', () => {
    for (const view of ['face_on', 'down_the_line'] as CameraView[]) {
      const s = swing(view, { noise: 0.004, seed: 3 });
      const hp = new HandClubProvider();
      const errs: number[] = [];
      for (const i of usableFrames(s)) {
        const est = hp.estimate(input(s, i, undefined));
        expect(est).not.toBeNull();
        expect(est!.source).toBe('hands');
        expect(est!.confidence).toBeLessThanOrEqual(HANDS_MAX_CONFIDENCE);
        errs.push(angleErr(est, s.truth.club[i]));
      }
      console.info(`[club] hands ${view}: median=${pctl(errs, 0.5).toFixed(1)}° p90=${pctl(errs, 0.9).toFixed(1)}°`);
      expect(pctl(errs, 0.5)).toBeLessThan(25);
    }
  });
});
