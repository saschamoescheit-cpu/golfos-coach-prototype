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

/** Convert RGBA pixels (e.g. from canvas getImageData) into a grayscale frame. */
export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return { width, height, data };
}
