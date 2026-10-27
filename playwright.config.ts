import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build (`pnpm build` first), in Firefox, muted.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } },
      },
    },
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: !process.env.CI,
  },
});
