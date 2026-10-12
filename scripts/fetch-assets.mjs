// Copies the MediaPipe WASM runtime and downloads the pose models into public/,
// so the app ships them itself and works offline (no CDN at runtime).
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';

const wasmSrc = 'node_modules/@mediapipe/tasks-vision/wasm';
mkdirSync('public/mediapipe', { recursive: true });
for (const f of readdirSync(wasmSrc)) {
  if (f.includes('nosimd') || f.includes('module')) continue; // SIMD build only (iOS 16.4+), non-module loader is the default
  copyFileSync(`${wasmSrc}/${f}`, `public/mediapipe/${f}`);
}

const models = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};
mkdirSync('public/models', { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const dest = `public/models/${name}`;
  if (existsSync(dest)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', name);
}
