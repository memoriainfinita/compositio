// Screenshots for docs/guide, from the production build (`pnpm build`, then `pnpm preview --port 4174`).
// Firefox, English, muted. Run by hand when the interface changes: `node scripts/screenshots.mjs`.

import { firefox } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://127.0.0.1:4174/';
const out = 'docs/guide/img/';
// Sample clips for the video captures: test pictures made with the ffmpeg installed here.
const clips = mkdtempSync(join(tmpdir(), 'compositio-shots-'));
const sources = [
  ['street.mp4', 'testsrc2=size=640x360:rate=25', 440],
  ['bars.mp4', 'smptebars=size=640x360:rate=25', 330],
  ['gradient.mp4', 'gradients=size=640x360:rate=25:speed=0.02', 220],
];
try {
  for (const [name, source, tone] of sources) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', source, '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000`, '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(clips, name)]);
  }
} catch {
  console.error('This script needs ffmpeg on the PATH to make the sample clips for the video captures.');
  process.exit(1);
}
const videos = sources.map(([name]) => join(clips, name));

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

async function addVideos(page, listed = true) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles(videos);
  if (listed) await page.locator('.file-title').nth(2).waitFor({ timeout: 30000 });
  await page.waitForTimeout(6000);
}

const video = await open({ width: 1440, height: 900 });
await addVideos(video);
await video.getByRole('complementary', { name: 'Output' }).getByLabel('Result').selectOption('video');
await video.getByRole('complementary', { name: 'Output' }).getByRole('checkbox', { name: 'Crop' }).check();
await video.getByTestId('crop-rect').waitFor();
await video.getByRole('complementary', { name: 'Output' }).screenshot({ path: `${out}picture.png` });
await video.getByRole('region', { name: 'Editor' }).screenshot({ path: `${out}editor-video.png` });

await video.getByRole('region', { name: 'Mix' }).getByRole('button', { name: 'Add selection' }).click();
await video.getByRole('region', { name: 'Mix' }).getByRole('group', { name: 'Mix result' }).getByRole('button', { name: 'Video' }).click();
await video.getByRole('region', { name: 'Mix' }).locator('img.mix-frame').first().waitFor({ timeout: 60000 });
const crossfade = video.getByRole('region', { name: 'Mix' }).getByLabel('Crossfade', { exact: true });
await crossfade.fill('1');
await crossfade.press('Tab');
await video.waitForTimeout(6000);
await video.getByRole('region', { name: 'Mix' }).screenshot({ path: `${out}mix-video.png` });

const phoneVideo = await open({ width: 390, height: 844 });
await addVideos(phoneVideo, false);
await phoneVideo.getByRole('button', { name: 'Mix', exact: true }).click();
await phoneVideo.getByRole('button', { name: 'Add selection' }).click({ timeout: 30000 });
await phoneVideo.getByRole('button', { name: 'Mix options' }).click();
await phoneVideo.getByRole('dialog', { name: 'Mix options' }).getByRole('group', { name: 'Mix result' }).getByRole('button', { name: 'Video' }).click();
await phoneVideo.getByRole('dialog', { name: 'Mix options' }).getByRole('button', { name: 'Done' }).click();
await phoneVideo.getByTestId('mix-monitor').waitFor();
await phoneVideo.waitForTimeout(3000);
await phoneVideo.screenshot({ path: `${out}phone-video.png` });

await browser.close();
