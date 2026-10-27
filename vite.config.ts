import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { serviceWorker } from './build/sw-plugin.ts';

// In dev there is no service worker, so the server sends the isolation headers itself.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// scripts/copy-ffmpeg.mjs serves each core under a versioned folder; the app loads it from there.
const coreVersion = (JSON.parse(readFileSync('node_modules/@ffmpeg/core/package.json', 'utf8')) as { version: string }).version;

export default defineConfig({
  // Relative base: works on GitHub Pages under /compositio/ and from any other path.
  base: './',
  plugins: [serviceWorker()],
  define: { __FFMPEG_CORE__: JSON.stringify(`ffmpeg/core-${coreVersion}/`) },
  server: { headers: isolation },
  // @ffmpeg/ffmpeg starts its Worker from a URL relative to its own module; prebundling breaks it.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
