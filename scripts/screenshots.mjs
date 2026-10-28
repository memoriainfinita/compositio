// Screenshots for docs/guide, from the production build (`pnpm build`, then `pnpm preview --port 4174`).
// Firefox, English, muted. Run by hand when the interface changes: `node scripts/screenshots.mjs`.

import { firefox } from '@playwright/test';

const base = 'http://127.0.0.1:4174/';
const out = 'docs/guide/img/';
const browser = await firefox.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0', 'layout.css.prefers-color-scheme.content-override': 1 } });

async function open(viewport) {
  const context = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.dataset.engine === 'ready', null, { timeout: 60000 });
  return page;
}

const desktop = await open({ width: 1440, height: 900 });
await desktop.screenshot({ path: `${out}home.png` });
await desktop.getByRole('button', { name: 'Try with an example' }).click();
await desktop.locator('.file-title').first().waitFor({ timeout: 30000 });
await desktop.getByText('3 tracks').first().waitFor({ timeout: 30000 });
// Waveforms are computed in the background.
await desktop.waitForTimeout(8000);
await desktop.screenshot({ path: `${out}workspace.png` });

await desktop.getByRole('complementary', { name: 'Output' }).screenshot({ path: `${out}output.png` });
await desktop.getByRole('region', { name: 'Mix' }).screenshot({ path: `${out}mix.png` });

await desktop.getByRole('button', { name: 'Save montage' }).click();
await desktop.locator('dialog[open]').getByRole('textbox').fill('Opening night');
await desktop.keyboard.press('Enter');
await desktop.locator('dialog[open]').waitFor({ state: 'detached' });
await desktop.getByRole('button', { name: 'Open montage' }).first().click();
await desktop.locator('dialog[open]').getByText('Opening night').first().waitFor();
await desktop.locator('dialog[open]').screenshot({ path: `${out}montages.png` });
await desktop.keyboard.press('Escape');

await desktop.getByRole('button', { name: /^Process/ }).first().click();
await desktop.getByRole('button', { name: /Download checked/ }).waitFor({ timeout: 90000 });
await desktop.screenshot({ path: `${out}exports.png` });

const phone = await open({ width: 390, height: 844 });
await phone.getByRole('button', { name: 'Try with an example' }).click();
await phone.waitForTimeout(8000);
await phone.getByRole('navigation').getByRole('tab', { name: 'Mix' }).or(phone.getByRole('navigation').getByRole('button', { name: 'Mix' })).first().click();
await phone.waitForTimeout(1000);
await phone.screenshot({ path: `${out}phone.png` });

await browser.close();
