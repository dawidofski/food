import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/food/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
