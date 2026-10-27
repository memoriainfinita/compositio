import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Step 10 on the production build: saving a montage, reopening it after a reload with its files
// missing and pairing them, opening without them, undoing an opening, exporting and importing.

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

const TRACKS = [
  { name: 'a.wav', mimeType: 'audio/wav', buffer: wav(20) },
  { name: 'b.wav', mimeType: 'audio/wav', buffer: wav(10) },
];

async function open(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 20000 });
}

async function choose(page: Page, button: string, files = TRACKS) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files);
}

/** After «Nuevo montaje» and a reload: nothing of «Gira» is in the session any more. */
async function fresh(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Abrir montaje' }).click();
  await library(page).getByRole('button', { name: 'Nuevo montaje' }).click();
  await expect(page.getByRole('button', { name: 'Probar con un ejemplo' })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
}

const library = (page: Page) => page.getByRole('dialog', { name: 'Montajes' });

/** Two files in the mix, saved as «Gira». */
async function saved(page: Page) {
  await open(page);
  await choose(page, 'Elegir archivos');
  await expect(page.locator('.file-title')).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Añadir selección' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Guardar montaje' }).click();
  const dialog = page.getByRole('dialog', { name: 'Guardar montaje' });
  await dialog.getByLabel('Nombre del montaje').fill('Gira');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Gira');
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('saves, reopens after a reload with the files missing and pairs them when added', async ({ page }) => {
  await saved(page);
  await fresh(page);
  await page.getByRole('button', { name: 'Abrir montaje' }).click();
  await expect(library(page).getByRole('button', { name: /Gira/ })).toContainText('2 pistas · 0:24');
  await expectAccessible(page);
  await library(page).getByRole('button', { name: /Gira/ }).click();
  await library(page).getByRole('button', { name: 'Abrir', exact: true }).click();

  const reopen = page.getByRole('dialog', { name: 'Gira' });
  await expect(reopen).toContainText('0 de 2 archivos');
  await expect(reopen.getByRole('img', { name: 'Falta' })).toHaveCount(2);
  await expect(reopen.getByRole('button', { name: 'Abrir', exact: true })).toBeDisabled();
  await expectAccessible(page);
  await choose(page, 'Añadir archivos');
  await expect(reopen).toContainText('2 de 2 archivos', { timeout: 30000 });
  await reopen.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mezcla' })).toContainText('2 pistas · 0:24');
  await expect(page.locator('.file-item.missing')).toHaveCount(0);
});

test('opens without the missing files, and undoing the opening brings the work back', async ({ page }) => {
  await saved(page);
  await fresh(page);
  await page.getByRole('button', { name: 'Abrir montaje' }).click();
  await library(page).getByRole('button', { name: /Gira/ }).click();
  await library(page).getByRole('button', { name: 'Abrir', exact: true }).click();
  const reopen = page.getByRole('dialog', { name: 'Gira' });
  await choose(page, 'Añadir archivos', TRACKS.slice(0, 1));
  await expect(reopen).toContainText('1 de 2 archivos', { timeout: 30000 });
  await reopen.getByRole('button', { name: 'Abrir sin los que faltan' }).click();
  await expect(page.locator('.file-title')).toHaveText(['a.wav']);
  await expect(page.getByRole('region', { name: 'Mezcla' })).toContainText('1 pista · 0:20');

  // First the missing file comes back, then the empty work there was before opening.
  await page.keyboard.press('Control+z');
  await expect(page.locator('.file-title')).toHaveText(['a.wav', 'b.wav']);
  await expect(page.locator('.file-item.missing')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Probar con un ejemplo' })).toBeVisible();
});

test('exports a montage and imports it back', async ({ page }) => {
  await saved(page);
  await page.getByRole('banner').getByRole('button', { name: 'Abrir montaje' }).click();
  await library(page).getByRole('button', { name: /Gira/ }).click();
  const download = page.waitForEvent('download');
  await library(page).getByRole('button', { name: 'Exportar' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('Gira.compositio.json');
  const text = await readFile(await d.path(), 'utf8');
  expect(JSON.parse(text)).toMatchObject({ format: 'compositio.montage', version: 1, id: null, name: 'Gira' });

  await library(page).getByRole('button', { name: 'Borrar' }).click();
  await expect(library(page)).toContainText('Sin montajes guardados');
  const chooser = page.waitForEvent('filechooser');
  await library(page).getByRole('button', { name: 'Importar' }).click();
  await (await chooser).setFiles({ name: 'Gira.compositio.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(library(page).getByRole('button', { name: /Gira/ })).toHaveAttribute('aria-pressed', 'true');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the folder opens the library and the mix options save the montage', async ({ page }) => {
    await open(page);
    await choose(page, 'Elegir archivos');
    await page.getByRole('button', { name: 'Mezcla' }).click();
    await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
    await page.getByRole('button', { name: 'Opciones de la mezcla' }).click();
    await page.getByRole('dialog', { name: 'Opciones de la mezcla' }).getByRole('button', { name: 'Guardar montaje' }).click();
    const dialog = page.getByRole('dialog', { name: 'Guardar montaje' });
    await dialog.getByLabel('Nombre del montaje').fill('Ensayo');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Montajes' }).click();
    await expect(library(page).getByRole('button', { name: /Ensayo/ })).toBeVisible();
    await expectAccessible(page);
  });
});
