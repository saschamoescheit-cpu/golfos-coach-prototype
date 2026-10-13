import type { GrayImage } from './ClubProvider';

/** Mirror a grayscale frame horizontally (left-handed swings are analysed mirrored). */
export function mirrorGray(img: GrayImage): GrayImage {
  const out = new Uint8ClampedArray(img.data.length);
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = img.data[row + (w - 1 - x)];
  }
  return { width: w, height: h, data: out };
}

/** Longest side of the grayscale frames the shaft detector works on (≈ 6 ms per frame, see decisions/club.md). */
export const CLUB_IMAGE_LONG_SIDE = 360;

let scratch: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;

/**
 * Grab the current picture of a video (or any canvas source) as a downscaled grayscale frame for the club detector.
 * Browser only (needs a canvas). Returns the ORIGINAL orientation – analyze.ts mirrors it for left-handers.
 * Usage while decoding an upload: seek the <video> to each analysed frame, then `grayFrameFrom(video, w, h)`.
 */
export function grayFrameFrom(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  longSide = CLUB_IMAGE_LONG_SIDE,
): GrayImage | null {
  if (!(srcWidth > 0 && srcHeight > 0)) return null;
  const k = Math.min(1, longSide / Math.max(srcWidth, srcHeight));
  const w = Math.max(1, Math.round(srcWidth * k));
  const h = Math.max(1, Math.round(srcHeight * k));
  if (!scratch) {
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return null;
    scratch = { canvas, ctx };
  }
  const { canvas, ctx } = scratch;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.drawImage(source, 0, 0, w, h);
  return rgbaToGray(ctx.getImageData(0, 0, w, h).data, w, h);
}

/** Convert RGBA pixels (e.g. from canvas getImageData) into a grayscale frame. */
export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return { width, height, data };
}
