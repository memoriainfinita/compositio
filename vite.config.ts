import { defineConfig } from 'vitest/config';
import { serviceWorker } from './build/sw-plugin.ts';

// In dev there is no service worker, so the server sends the isolation headers itself.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Relative base: works on GitHub Pages under /compositio/ and from any other path.
  base: './',
  plugins: [serviceWorker()],
  server: { headers: isolation },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
