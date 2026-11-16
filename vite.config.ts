import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/food/',
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate would activate a new worker and reload the page at once, even with a
      // warning gate open. The app registers the worker itself (src/main.tsx) and applies an update when idle.
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // The manifest is a hand-written file in public/ and linked from index.html.
      manifest: false,
      injectManifest: {
        // The app shell AND the dataset (the foods file and its meta.json): without them the app cannot
        // resolve a single food offline. The foods file is about 4 MB, over workbox's 2 MB default ceiling.
        globPatterns: ['**/*.{js,css,html,png,webmanifest}', 'data/*.json'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
