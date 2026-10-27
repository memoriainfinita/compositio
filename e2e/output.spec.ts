import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Step 8 on the production build: processing one file and a batch, own settings, normalizing (and
// the editor's B with it), presets, quick actions, cancelling and retrying. Results are read back
// by the app itself: dropping one in runs ffprobe on it.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

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
  // Web Audio's way out goes through a silent gain, as in the editor's tests.
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

async function choose(page: Page, files: { name: string; buffer: Buffer; mimeType?: string }[]) {
  const chooser = page.waitForEvent('filechooser');
  const button = page.getByRole('button', { name: 'Elegir archivos' });
  if (await button.isVisible()) await button.click();
  else await page.getByRole('button', { name: 'Soltar archivos o carpeta' }).click();
  await (await chooser).setFiles(files.map((f) => ({ mimeType: 'audio/wav', ...f })));
}

const files = (page: Page) => page.getByRole('complementary', { name: 'Archivos' });
const output = (page: Page) => page.getByRole('complementary', { name: 'Salida' });

async function loaded(page: Page, n: number) {
  await expect(files(page).locator('.file-title')).toHaveCount(n, { timeout: 30000 });
  await expect(files(page).getByRole('status')).toHaveCount(0, { timeout: 30000 });
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('processes one file to FLAC and downloads it directly; the result reads back as FLAC', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(3) }]);
  await loaded(page, 1);
  await output(page).getByLabel('Formato').selectOption('flac');
  const download = page.waitForEvent('download');
  await output(page).getByRole('button', { name: 'Procesar 1' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('tono.flac');
  const bytes = await readFile(await d.path());
  expect(bytes.subarray(0, 4).toString()).toBe('fLaC');

  await choose(page, [{ name: 'tono.flac', buffer: bytes, mimeType: 'audio/flac' }]);
  await loaded(page, 2);
  await files(page).getByRole('button', { name: 'tono.flac' }).click();
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText('FLAC · 8 kHz · 24 bit · mono');
  await expect(page.locator('.queue-bar')).toContainText('1 de 1');
  await expectAccessible(page);
});

test('a batch goes as one zip with names from the pattern', async ({ page }) => {
  await open(page);
  await choose(page, [
    { name: 'b.wav', buffer: wav(1) },
    { name: 'a.wav', buffer: wav(1.5) },
  ]);
  await loaded(page, 2);
  const pattern = output(page).getByLabel('Nombre', { exact: true });
  await pattern.fill('');
  await output(page).getByRole('button', { name: '{n}' }).click();
  await pattern.fill('{n} - ');
  await output(page).getByRole('button', { name: '{name}' }).click();
  await expect(pattern).toHaveValue('{n} - {name}');
  await expect(output(page).locator('.example')).toHaveText('01 - a.wav');
  await output(page).getByLabel('Descargar en un zip').check();
  const download = page.waitForEvent('download');
  await output(page).getByRole('button', { name: 'Procesar 2' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('compositio.zip');
  const bytes = await readFile(await d.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('01 - a.wav'))).toBe(true);
  expect(bytes.includes(Buffer.from('02 - b.wav'))).toBe(true);
});

test('own settings carry a mark and go back to the batch', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(1) }]);
  await loaded(page, 1);
  await output(page).getByRole('button', { name: 'Este archivo' }).click();
  await output(page).getByLabel('Formato').selectOption('mp3');
  await expect(files(page).getByRole('img', { name: 'Ajustes propios' })).toBeVisible();
  await expect(output(page).getByRole('button', { name: 'Volver al valor del lote: Formato' })).toBeVisible();
  await expect(output(page).locator('.example')).toHaveText('tono.mp3');
  await expectAccessible(page);
  await output(page).getByRole('button', { name: 'Volver al valor del lote: Formato' }).click();
  await expect(files(page).getByRole('img', { name: 'Ajustes propios' })).toHaveCount(0);
  await output(page).getByRole('button', { name: 'Lote', exact: true }).click();
  await expect(output(page).getByLabel('Formato')).toHaveValue('wav');
  await page.keyboard.press('Control+z');
  await expect(files(page).getByRole('img', { name: 'Ajustes propios' })).toBeVisible();
});

test('normalizing: B sounds at the measured gain, and the result is louder', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(4) }]);
  await loaded(page, 1);
  await output(page).getByLabel('Normalizar', { exact: true }).check();
  await output(page).getByLabel('Objetivo').fill('-14');
  await output(page).getByLabel('Objetivo').press('Tab');

  const editor = page.getByRole('region', { name: 'Editor' });
  await expect(editor.locator('.wave')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await editor.getByRole('button', { name: 'B', exact: true }).click();
  await editor.getByRole('slider', { name: 'Posición' }).focus();
  await page.keyboard.press('ArrowRight');
  // A 440 Hz tone at -24 dBFS RMS needs about 10 dB more to reach -14 LUFS.
  await expect.poll(async () => Number(await editor.locator('.editor-stage').getAttribute('data-gain')), { timeout: 30000 }).toBeGreaterThan(2.5);

  const download = page.waitForEvent('download');
  await output(page).getByRole('button', { name: 'Procesar 1' }).click();
  const bytes = await readFile(await (await download).path());
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + 44, 2000);
  expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(6000);
});

test('presets: starters, save, rename, export, delete, import, apply', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(1) }]);
  await loaded(page, 1);
  const picker = output(page).getByRole('combobox', { name: 'Preset' });
  await expect(picker.locator('option')).toHaveText(['Ajustes sin preset', 'WAV 48 kHz 24 bit', 'Teatro: WAV 48 kHz, -14 LUFS', 'MP3 320']);
  await picker.selectOption({ label: 'MP3 320' });
  await expect(output(page).getByLabel('Formato')).toHaveValue('mp3');

  await output(page).getByRole('button', { name: 'Presets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Presets' });
  await dialog.getByRole('textbox', { name: 'Nombre del preset nuevo' }).fill('Mío');
  await dialog.getByRole('button', { name: 'Guardar el lote' }).click();
  const names = dialog.getByRole('textbox', { name: 'Nombre del preset', exact: true });
  await expect(names).toHaveCount(4);
  await names.nth(3).fill('Radio');
  await names.nth(3).press('Enter');
  await expect(picker.locator('option').nth(4)).toHaveText('Radio');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Exportar' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('compositio-presets.json');
  const exported = await readFile(await d.path(), 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ format: 'compositio.presets', version: 1 });

  await dialog.getByRole('button', { name: 'Borrar' }).first().click();
  await expect(names).toHaveCount(3);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Importar' }).click();
  await (await chooser).setFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(names).toHaveCount(7);
  await expectAccessible(page);

  // Presets live outside the project: a reload keeps them.
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
  await expect(output(page).getByRole('combobox', { name: 'Preset' }).locator('option')).toHaveCount(8);
});

test('quick actions process the selection, and files dropped on one', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(1) }]);
  await loaded(page, 1);
  const quick = files(page).getByRole('group', { name: 'Acciones rápidas' });
  let download = page.waitForEvent('download');
  await quick.getByRole('button', { name: 'MP3 320' }).click();
  expect((await download).suggestedFilename()).toBe('tono.mp3');
  // The batch is untouched.
  await expect(output(page).getByLabel('Formato')).toHaveValue('wav');

  download = page.waitForEvent('download');
  const payload = wav(1).toString('base64');
  await quick.getByRole('button', { name: 'MP3 320' }).evaluate((button, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], 'otro.wav', { type: 'audio/wav', lastModified: 1 }));
    for (const type of ['dragenter', 'dragover', 'drop']) button.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, payload);
  expect((await download).suggestedFilename()).toBe('otro.mp3');
  await expect(files(page).locator('.file-title')).toHaveText(['tono.wav', 'otro.wav']);
});

test('the queue cancels and retries', async ({ page }) => {
  await open(page);
  await choose(page, [
    { name: 'uno.wav', buffer: wav(240) },
    { name: 'dos.wav', buffer: wav(2) },
  ]);
  await loaded(page, 2);
  await output(page).getByLabel('Normalizar', { exact: true }).check();
  await output(page).getByRole('button', { name: 'Procesar 2' }).click();
  await page.locator('.queue-open').click();
  const dialog = page.getByRole('dialog', { name: 'Cola' });
  const second = dialog.locator('.job').filter({ hasText: 'dos.wav' });
  await second.getByRole('button', { name: 'Cancelar' }).click();
  await expect(second).toContainText('Cancelado');
  await expectAccessible(page);
  const first = page.waitForEvent('download', { timeout: 60000 });
  await second.getByRole('button', { name: 'Reintentar' }).click();
  expect((await first).suggestedFilename()).toBe('uno.wav');
  await expect(second).toContainText('Hecho', { timeout: 60000 });
  const download = page.waitForEvent('download');
  await second.getByRole('button', { name: 'Descargar' }).click();
  expect((await download).suggestedFilename()).toBe('dos.wav');
  await dialog.getByRole('button', { name: 'Limpiar terminados' }).click();
  await expect(dialog.locator('.job')).toHaveCount(0);
});

test('accessible on tablet and phone', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'tono.wav', buffer: wav(1) }]);
  await loaded(page, 1);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByRole('button', { name: 'Procesar 1' })).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ajustes de salida' }).click();
  await expect(page.getByRole('dialog', { name: 'Salida' }).getByRole('button', { name: 'Procesar 1' })).toBeVisible();
  await expectAccessible(page);
});
