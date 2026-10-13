/** Device checks for the shipped MediaPipe build (review K5). No MediaPipe import – testable in Node. */
/** Thrown when the device cannot run the shipped (SIMD) MediaPipe build – e.g. iOS older than 16.4. */
export class PoseUnsupportedError extends Error {
  constructor() {
    super('WebAssembly SIMD is not supported on this device');
    this.name = 'PoseUnsupportedError';
  }
}

/** Tiny module whose function uses SIMD instructions (i8x16.splat, i8x16.popcnt) – the probe of wasm-feature-detect. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
