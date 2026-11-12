import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Step 5 of phase 2 on the production build: a mix whose clips have picture generates a video, by
// WebCodecs and by ffmpeg, and the result reads back with the canvas and the length the mix promised.
// Also the strip's pictures, the monitor, the refusal of a mix with no picture, and a file's in point
// shortening its video. The clips are 160×90, 3 s, made by ffmpeg and kept in e2e/fixtures.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

const fixture = (name: string) => readFile(join(process.cwd(), 'e2e', 'fixtures', name));

function wav(seconds: number, rate = 8000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}

async function open(page: Page) {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
    AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
      if (dest instanceof AudioDestinationNode) {
        const mute = this.context.createGain();
        mute.gain.value = 0;
        connect.call(mute, dest);
        return connect.call(this, mute, ...rest);
      }
      return connect.call(this, dest, ...rest);
    } as typeof AudioNode.prototype.connect;
  });
  await page.goto('./');
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 20000 });
}

type Upload = { name: string; buffer: Buffer; mimeType: string };
const mp4 = (name: string, buffer: Buffer): Upload => ({ name, buffer, mimeType: 'video/mp4' });
const tone = (name: string): Upload => ({ name, buffer: wav(3), mimeType: 'audio/wav' });

async function choose(page: Page, uploads: Upload[]) {
  const chooser = page.waitForEvent('filechooser');
  const button = page.getByRole('button', { name: 'Elegir archivos' });
  if (await button.isVisible()) await button.click();
  else await page.getByRole('button', { name: 'Soltar archivos o carpeta' }).click();
  await (await chooser).setFiles(uploads);
}

const files = (page: Page) => page.getByRole('complementary', { name: 'Archivos' });
const output = (page: Page) => page.getByRole('complementary', { name: 'Salida' });
const editor = (page: Page) => page.getByRole('region', { name: 'Editor' });
const mix = (page: Page) => page.getByRole('region', { name: 'Mezcla' });

async function loaded(page: Page, n: number) {
  await expect(files(page).locator('.file-title')).toHaveCount(n, { timeout: 30000 });
  await expect(files(page).getByRole('status')).toHaveCount(0, { timeout: 30000 });
}

async function downloadChecked(page: Page) {
  const button = page.getByRole('dialog', { name: 'Exportaciones' }).getByRole('button', { name: 'Descargar marcados (1)' });
  await button.waitFor({ timeout: 180000 });
  const download = page.waitForEvent('download');
  await button.click();
  return download;
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The three clips of the mix: a picture with sound, a picture without, and a sound alone. */
async function threeClips(page: Page) {
  await choose(page, [mp4('clip.mp4', await fixture('clip.mp4')), mp4('mudo.mp4', await fixture('clip-silent.mp4')), tone('voz.wav')]);
  await loaded(page, 3);
  await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
  await mix(page).getByRole('button', { name: 'Añadir selección' }).click();
  await expect(mix(page).locator('.mix-clip-name')).toHaveText(['clip.mp4', 'mudo.mp4', 'voz.wav']);
}

async function asVideo(page: Page, crossfade = 1) {
  await mix(page).getByRole('group', { name: 'Resultado de la mezcla' }).getByRole('button', { name: 'Vídeo' }).click();
  const field = mix(page).getByLabel('Fundido cruzado', { exact: true });
  await field.fill(String(crossfade));
  await field.press('Tab');
}

test('a video mix shows the pictures of its clips, the black of a sound, and the monitor', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await threeClips(page);
  await expect(mix(page).locator('.mix-frame')).toHaveCount(0);
  await asVideo(page);
  await expect(mix(page).getByRole('group', { name: 'Formato de la mezcla' })).toHaveCount(0);
  await expect(mix(page).getByRole('group', { name: 'Opciones del vídeo de la mezcla' })).toBeVisible();
  // Two clips with picture, one with only sound that plays as black.
  await expect(mix(page).locator('img.mix-frame')).toHaveCount(2, { timeout: 30000 });
  await expect(mix(page).locator('.mix-black')).toHaveText('Negro');
  await expect(mix(page)).toContainText('3 pistas · 0:07');

  const monitor = mix(page).getByTestId('mix-monitor');
  await expect(monitor).toBeVisible();
  await expect(monitor.locator('video')).toHaveCount(1);
  expect(await monitor.evaluate((el) => getComputedStyle(el).getPropertyValue('--ratio').trim())).toBe('1.7778');
  await expectAccessible(page);
});

test('a video mix in HAP: its options, a mov with the Hap texture, and the browser as its only engine', async ({ page }) => {
  await page.goto('./');
  const decodes = await page.evaluate(async () => typeof VideoDecoder === 'function' && (await VideoDecoder.isConfigSupported({ codec: 'avc1.640028' }).then((r) => !!r.supported, () => false)));
  test.skip(!decodes, 'this browser cannot decode H.264, which HAP needs');
  await open(page);
  await threeClips(page);
  await asVideo(page);
  const options = mix(page).getByRole('group', { name: 'Opciones del vídeo de la mezcla' });
  await options.getByLabel('Formato de vídeo').selectOption({ label: 'HAP (MOV)' });
  await expect(options.getByLabel('Variante de HAP')).toHaveValue('hap');
  await expect(options.getByLabel('Calidad')).toHaveCount(0);
  await options.getByLabel('Variante de HAP').selectOption({ label: 'Hap Q' });
  await mix(page).getByRole('button', { name: 'Generar mezcla' }).click();
  const d = await downloadChecked(page);
  expect(d.suggestedFilename()).toBe('mezcla.mov');
  await page.keyboard.press('Escape');
  const bytes = await readFile(await d.path());
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  // The index is at the end: the Hap Q fourcc and the PCM sound entry are in it.
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
  expect(tail).toContain('HapY');
  expect(tail).toContain('in24');
});

for (const engine of ['auto', 'ffmpeg'] as const) {
  test(`generates the video mix by ${engine === 'auto' ? 'the automatic engine' : 'ffmpeg'} and it reads back`, async ({ page }) => {
    await open(page);
    if (engine === 'ffmpeg') {
      await page.getByRole('button', { name: 'Acerca de' }).click();
      await page.getByRole('dialog', { name: 'Acerca de compositio' }).getByLabel('Quién hace el vídeo').selectOption('ffmpeg');
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
    }
    await threeClips(page);
    await asVideo(page);
    await mix(page).getByRole('button', { name: 'Generar mezcla' }).click();
    const d = await downloadChecked(page);
    expect(d.suggestedFilename()).toBe('mezcla.mp4');
    await page.keyboard.press('Escape');
    const bytes = await readFile(await d.path());
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp');

    await choose(page, [mp4('resultado.mp4', bytes)]);
    await loaded(page, 4);
    const row = files(page).getByRole('listitem').filter({ hasText: 'resultado.mp4' });
    await expect(row.locator('.file-duration')).toHaveText(/^0:0[67]/);
    await files(page).getByRole('button', { name: 'resultado.mp4' }).click();
    await expect(editor(page)).toContainText('160×90');
    await expect(editor(page).getByRole('group', { name: 'Comparar' })).toBeVisible();
  });
}

test('a video mix with no picture is not offered to generate', async ({ page }) => {
  await open(page);
  await choose(page, [tone('voz.wav'), tone('otra.wav')]);
  await loaded(page, 2);
  await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
  await mix(page).getByRole('button', { name: 'Añadir selección' }).click();
  await asVideo(page);
  const go = mix(page).getByRole('button', { name: 'Generar mezcla' });
  await expect(go).toBeDisabled();
  await expect(go).toHaveAttribute('title', 'Ningún clip de la mezcla tiene imagen');
});

test('a file’s in point shortens the video it makes', async ({ page }) => {
  await open(page);
  await choose(page, [mp4('clip.mp4', await fixture('clip.mp4'))]);
  await loaded(page, 1);
  await editor(page).getByRole('textbox', { name: 'Entrada' }).fill('0:01.000');
  await editor(page).getByRole('textbox', { name: 'Entrada' }).press('Enter');
  await expect(editor(page).getByRole('textbox', { name: 'Entrada' })).toHaveValue('0:01.000');
  await output(page).getByLabel('Resultado').selectOption('video');
  await output(page).getByRole('button', { name: 'Procesar 1 marcado' }).click();
  const d = await downloadChecked(page);
  await page.keyboard.press('Escape');
  const bytes = await readFile(await d.path());

  await choose(page, [mp4('corto.mp4', bytes)]);
  await loaded(page, 2);
  const row = files(page).getByRole('listitem').filter({ hasText: 'corto.mp4' });
  await expect(row.locator('.file-duration')).toHaveText(/^0:0[12]/);
  await expect(row.locator('.file-duration')).not.toHaveText(/^0:03/);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the options sheet makes the mix a video and the monitor sits above the list', { tag: '@a11y' }, async ({ page }) => {
    await open(page);
    await choose(page, [mp4('clip.mp4', await fixture('clip.mp4')), mp4('mudo.mp4', await fixture('clip-silent.mp4'))]);
    await page.getByRole('button', { name: 'Mezcla' }).click();
    await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
    await page.getByRole('button', { name: 'Añadir selección' }).click();
    await page.getByRole('button', { name: 'Opciones de la mezcla' }).click();
    const sheet = page.getByRole('dialog', { name: 'Opciones de la mezcla' });
    await sheet.getByRole('group', { name: 'Resultado de la mezcla' }).getByRole('button', { name: 'Vídeo' }).click();
    await expect(sheet.getByRole('group', { name: 'Opciones del vídeo de la mezcla' })).toBeVisible();
    await expectAccessible(page);
    await sheet.getByRole('button', { name: 'Listo' }).click();
    const monitor = page.getByTestId('mix-monitor');
    await expect(monitor).toBeVisible();
    const list = page.locator('.mix-list');
    expect((await monitor.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
    await expectAccessible(page);
  });
});
