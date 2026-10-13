import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME, MODULE_NAME } from './src/coach/model/constants';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
/** Home-screen / window title, e.g. "GolfOS Coach" – the brand name comes from APP_NAME (still a working title). */
const TITLE = `${APP_NAME} ${MODULE_NAME}`;

/** index.html uses %APP_TITLE% so the name lives in one place (constants.ts). */
const appTitleInHtml = (): Plugin => ({
  name: 'app-title-in-html',
  transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%APP_TITLE%', TITLE) },
});

// base './' so the build works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
  plugins: [
    react(),
    appTitleInHtml(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate': an automatic reload could hit the player in the middle of a recording or a
      // training series. The app shows "A new version is ready – Reload" instead (src/ui/components/OfflineHint.tsx).
      registerType: 'prompt',
      injectRegister: false, // registered in OfflineHint via virtual:pwa-register
      // icons are already matched by globPatterns – adding them again would only duplicate precache entries
      includeManifestIcons: false,
      manifest: {
        name: TITLE,
        short_name: TITLE,
        description: `${TITLE} – swing analysis with corrections (prototype)`,
        lang: 'en',
        theme_color: '#0E1418',
        background_color: '#0E1418',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell, MediaPipe runtime and the pose models are precached → the app works offline after the first visit.
        // Precache ≈ 28 MB: vision_wasm_internal.wasm ≈ 13 MB, pose_landmarker_full.task ≈ 9.4 MB, lite ≈ 5.8 MB.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,wasm,task,json}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024, // largest single file (WASM) ≈ 13 MB
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
