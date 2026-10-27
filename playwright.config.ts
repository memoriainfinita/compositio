import { defineConfig, devices } from '@playwright/test';

// End-to-end tests in Firefox, muted. The service worker runs against the production build
// (`pnpm build` first); the engine against the dev server, which imports its modules directly.
// Playwright's colorScheme emulation does not reach Firefox here; its own pref does (0 dark, 1 light).
const firefox = (theme: 0 | 1 = 0) => ({
  ...devices['Desktop Firefox'],
  launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0', 'layout.css.prefers-color-scheme.content-override': theme } },
});

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'app', testMatch: /(service-worker|ui)\.spec\.ts/, use: { ...firefox(), locale: 'es-ES', baseURL: 'http://127.0.0.1:4174/' } },
    // The interface again in the light theme.
    { name: 'app-light', testMatch: /ui\.spec\.ts/, use: { ...firefox(1), locale: 'es-ES', baseURL: 'http://127.0.0.1:4174/' } },
    { name: 'engine', testMatch: /engine\.spec\.ts/, use: { ...firefox(), baseURL: 'http://127.0.0.1:4176/' } },
  ],
  webServer: [
    {
      command: 'pnpm preview --host 127.0.0.1',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm dev --host 127.0.0.1 --port 4176 --strictPort',
      url: 'http://127.0.0.1:4176/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
