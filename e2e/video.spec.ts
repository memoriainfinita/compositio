import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Step 4 of phase 2 on the production build: video in the editor (with and without sound), the
// «Imagen» step with the crop's numbers and the rectangle over the picture, processing to H.264 and
// reading the result back, frame grabbing, replacing the sound, the reasons a file is refused and
// the «Motor de vídeo» setting. The clips are 160×90, 3 s, made by ffmpeg and kept in e2e/fixtures.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 150_000 });
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

async function choose(page: Page, files: Upload[]) {
  const chooser = page.waitForEvent('filechooser');
  const button = page.getByRole('button', { name: 'Elegir archivos' });
  if (await button.isVisible()) await button.click();
  else await page.getByRole('button', { name: 'Soltar archivos o carpeta' }).click();
  await (await chooser).setFiles(files);
}

const files = (page: Page) => page.getByRole('complementary', { name: 'Archivos' });
const output = (page: Page) => page.getByRole('complementary', { name: 'Salida' });
const editor = (page: Page) => page.getByRole('region', { name: 'Editor' });

async function loaded(page: Page, n: number) {
  await expect(files(page).locator('.file-title')).toHaveCount(n, { timeout: 30000 });
  await expect(files(page).getByRole('status')).toHaveCount(0, { timeout: 30000 });
}

async function downloadChecked(page: Page, n = 1) {
  const button = page.getByRole('dialog', { name: 'Exportaciones' }).getByRole('button', { name: `Descargar marcados (${n})` });
  await button.waitFor({ timeout: 120000 });
  const download = page.waitForEvent('download');
  await button.click();
  return download;
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('a video without sound opens in the editor with its picture and no waveform to compare', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await choose(page, [mp4('mudo.mp4', await fixture('clip-silent.mp4'))]);
  await loaded(page, 1);
  await expect(editor(page).locator('video')).toHaveCount(1);
  await expect(editor(page).getByRole('slider', { name: 'Posición' })).toBeVisible();
  await expect(editor(page).getByRole('group', { name: 'Comparar' })).toHaveCount(0);
  await expect(editor(page)).not.toContainText('Sin pista de audio');
  await expect(editor(page)).toContainText('160×90');
  await editor(page).getByRole('textbox', { name: 'Entrada' }).fill('0:01.000');
  await editor(page).getByRole('textbox', { name: 'Entrada' }).press('Enter');
  await expect(editor(page).getByRole('textbox', { name: 'Entrada' })).toHaveValue('0:01.000');
  await expectAccessible(page);
});

test('«Imagen» appears with a video output; the crop’s numbers and the rectangle on the picture agree', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await choose(page, [mp4('clip.mp4', await fixture('clip.mp4'))]);
  await loaded(page, 1);
  const out = output(page);
  await expect(out.getByRole('heading', { name: '3 Imagen' })).toHaveCount(0);
  await out.getByLabel('Resultado').selectOption('video');
  await expect(out.getByRole('heading', { name: '3 Imagen' })).toBeVisible();
  await expect(out.getByTestId('picture-size')).toHaveText('Sale a 160×90');

  await out.getByRole('checkbox', { name: 'Encuadre' }).check();
  const rect = page.getByTestId('crop-rect');
  await expect(rect).toBeVisible();
  await expect(out.getByLabel('Izquierda')).toHaveValue('16');
  await expect(out.getByLabel('Arriba')).toHaveValue('8');
  await expect(out.getByLabel('Ancho', { exact: true })).toHaveValue('128');
  await expect(out.getByLabel('Alto', { exact: true })).toHaveValue('74');
  await expect(out.getByTestId('picture-size')).toHaveText('Sale a 128×74');

  // Typing moves the rectangle…
  await out.getByLabel('Ancho', { exact: true }).fill('80');
  await out.getByLabel('Ancho', { exact: true }).press('Tab');
  await expect(rect).toHaveAttribute('style', /width: 50%/);

  // …and dragging a handle changes the numbers.
  const handle = page.locator('.crop-handle[data-handle="se"]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const width = Number(await out.getByLabel('Ancho', { exact: true }).inputValue());
  expect(width).toBeGreaterThan(80);
  expect(width % 2).toBe(0);
  await expect(rect).toHaveAttribute('style', new RegExp(`width: ${(width / 160) * 100}%`));

  // A quarter turn turns the picture and keeps the crop inside the new frame.
  await out.getByLabel('Rotación').selectOption('90');
  await expect(page.locator('.picture-frame')).toHaveAttribute('data-turn', '90');
  await expect(out.getByTestId('picture-size')).toContainText('Sale a ');
  await expectAccessible(page);

  // Without the crop the rectangle goes; with sound as the result the picture's step goes too.
  await out.getByRole('checkbox', { name: 'Encuadre' }).uncheck();
  await expect(rect).toHaveCount(0);
  await out.getByLabel('Resultado').selectOption('audio');
  await expect(out.getByRole('heading', { name: '3 Imagen' })).toHaveCount(0);
});

test('processes a video to H.264 at another size and the result reads back', async ({ page }) => {
  await open(page);
  await choose(page, [mp4('clip.mp4', await fixture('clip.mp4'))]);
  await loaded(page, 1);
  const out = output(page);
  await out.getByLabel('Resultado').selectOption('video');
  await out.getByLabel('Tamaño', { exact: true }).selectOption('fit');
  await out.getByLabel('Ancho de salida').fill('96');
  await out.getByLabel('Ancho de salida').press('Tab');
  await out.getByLabel('Alto de salida').fill('54');
  await out.getByLabel('Alto de salida').press('Tab');
  await expect(out.getByTestId('picture-size')).toHaveText('Sale a 96×54');
  await expect(out.getByTestId('picture-engine')).toContainText('Motor:');

  await out.getByRole('button', { name: 'Procesar 1 marcado' }).click();
  const d = await downloadChecked(page);
  expect(d.suggestedFilename()).toBe('clip.mp4');
  await page.keyboard.press('Escape');
  const bytes = await readFile(await d.path());
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');

  await choose(page, [mp4('salida.mp4', bytes)]);
  await loaded(page, 2);
  await files(page).getByRole('button', { name: 'salida.mp4' }).click();
  await expect(editor(page)).toContainText('96×54');
});

test('grabs a frame as a PNG named after the file and the instant', async ({ page }) => {
  await open(page);
  await choose(page, [mp4('clip.mp4', await fixture('clip.mp4'))]);
  await loaded(page, 1);
  const download = page.waitForEvent('download', { timeout: 90000 });
  await editor(page).getByRole('button', { name: 'Sacar fotograma' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('clip-0.00.000.png');
  const bytes = await readFile(await d.path());
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test('replaces a video’s sound with another file’s, offered only among a file’s own settings', async ({ page }) => {
  await open(page);
  await choose(page, [mp4('mudo.mp4', await fixture('clip-silent.mp4')), tone('voz.wav')]);
  await loaded(page, 2);
  await files(page).getByRole('button', { name: 'mudo.mp4' }).click();
  const out = output(page);
  await out.getByLabel('Resultado').selectOption('video');
  const sound = out.getByLabel('Audio del vídeo');
  await expect(sound.locator('option')).toHaveText(['Conservar', 'Quitar', 'Silencio']);
  await expect(sound).toHaveAttribute('title', /solo se ofrece en «Solo este archivo»/);

  await out.getByRole('button', { name: 'Solo este archivo' }).click();
  await expect(sound.locator('option')).toHaveText(['Conservar', 'Quitar', 'Silencio', 'Sustituir por otro archivo']);
  await sound.selectOption('replace');
  await expect(out.getByRole('combobox', { name: 'Archivo con el audio' })).toContainText('voz.wav');

  await files(page).getByRole('checkbox', { name: 'Marcar todos' }).uncheck();
  await out.getByRole('button', { name: 'Procesar este archivo' }).click();
  const d = await downloadChecked(page);
  expect(d.suggestedFilename()).toBe('mudo.mp4');
  await page.keyboard.press('Escape');
  const bytes = await readFile(await d.path());

  await choose(page, [mp4('con-voz.mp4', bytes)]);
  await loaded(page, 3);
  await files(page).getByRole('button', { name: 'con-voz.mp4' }).click();
  await expect(editor(page).getByRole('group', { name: 'Comparar' })).toBeVisible();
});

test('says why a file is not processed', async ({ page }) => {
  await open(page);
  await choose(page, [tone('voz.wav')]);
  await loaded(page, 1);
  await output(page).getByLabel('Resultado').selectOption('video');
  await output(page).getByRole('button', { name: 'Procesar 1 marcado' }).click();
  await expect(page.getByText('1 archivo sin procesar: voz.wav (no tiene imagen)')).toBeAttached();
});

test('«Motor de vídeo» is chosen in «Acerca de» and remembered', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Acerca de' }).click();
  const dialog = page.getByRole('dialog', { name: 'Acerca de compositio' });
  const engine = dialog.getByLabel('Quién hace el vídeo');
  await expect(engine).toHaveValue('auto');
  await expect(dialog.getByTestId('webcodecs-support')).not.toContainText('comprobando', { timeout: 20000 });
  await expectAccessible(page);
  await engine.selectOption('ffmpeg');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
  await page.getByRole('button', { name: 'Acerca de' }).click();
  await expect(page.getByRole('dialog', { name: 'Acerca de compositio' }).getByLabel('Quién hace el vídeo')).toHaveValue('ffmpeg');
});
