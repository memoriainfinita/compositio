import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig([
  { ignores: ['dist/**', 'public/ffmpeg/**', 'spikes/**', 'vendor/**', '.archive/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**', 'build/**', '*.config.*', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/sw/sw.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
]);
