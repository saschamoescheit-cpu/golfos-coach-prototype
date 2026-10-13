import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' so the build works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'GolfOS Coach',
        short_name: 'GolfOS Coach',
        description: 'GolfOS prototype – swing analysis with corrections',
        theme_color: '#0E1418',
        background_color: '#0E1418',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell, MediaPipe runtime and the pose models are precached → the app works offline after the first visit.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,wasm,task,json}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024, // WASM runtime ≈ 13 MB, full model ≈ 9 MB
      },
    }),
  ],
});
