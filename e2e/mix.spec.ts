import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Step 9 on the production build: the mix strip, overlaps by keyboard and by dragging, the
// transition popup with its preview, generating WAV and MP3, the times CSV and the phone list.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

function wav(seconds: number, freq = 440, rate = 8000): Buffer {
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
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return b;
}

/** Seconds of a WAV from its data chunk and format. */
function wavSeconds(bytes: Buffer): number {
  const rate = bytes.readUInt32LE(24);
  const blockAlign = bytes.readUInt16LE(32);
  const data = bytes.indexOf('data', 12);
  return bytes.readUInt32LE(data + 4) / blockAlign / rate;
}

async function open(page: Page) {
  // Web Audio's way out goes through a silent gain: the tests play the mix, nobody hears it.
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

async function threeTracks(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  const button = page.getByRole('button', { name: 'Elegir archivos' });
  if (await button.isVisible()) await button.click();
  else await page.getByRole('button', { name: 'Añadir archivos' }).click();
  await (await chooser).setFiles([
    { name: 'a.wav', mimeType: 'audio/wav', buffer: wav(20, 330) },
    { name: 'b.wav', mimeType: 'audio/wav', buffer: wav(20, 440) },
    { name: 'c.wav', mimeType: 'audio/wav', buffer: wav(20, 550) },
  ]);
}

const mix = (page: Page) => page.getByRole('region', { name: 'Mezcla' });

async function filled(page: Page) {
  await open(page);
  await threeTracks(page);
  await expect(page.locator('.file-title')).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
  await mix(page).getByRole('button', { name: 'Añadir selección' }).click();
  await expect(mix(page)).toContainText('3 pistas · 0:48');
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('adds the selection, moves an overlap by keyboard and undoes it, and generates the WAV', { tag: '@a11y' }, async ({ page }) => {
  await filled(page);
  const overlap = mix(page).getByRole('slider', { name: 'Solape con a.wav' });
  await expect(overlap).toHaveAttribute('aria-valuetext', '6 s');
  await overlap.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(overlap).toHaveAttribute('aria-valuetext', '7 s');
  await expect(mix(page)).toContainText('3 pistas · 0:47');
  await page.keyboard.press('Control+z');
  await expect(overlap).toHaveAttribute('aria-valuetext', '6 s');
  await expectAccessible(page);

  const download = page.waitForEvent('download');
  await mix(page).getByRole('button', { name: 'Generar mezcla' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('mezcla.wav');
  const bytes = await readFile(await d.path());
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect(bytes.readUInt32LE(24)).toBe(44100);
  expect(wavSeconds(bytes)).toBeCloseTo(48, 1);
});

test('the transition popup previews the cross and applies a dry cut', { tag: '@a11y' }, async ({ page }) => {
  await filled(page);
  await mix(page).getByRole('slider', { name: 'Solape con b.wav' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transición' });
  await expect(dialog).toContainText('b.wav');
  await dialog.getByRole('button', { name: 'Escuchar' }).click();
  const audio = dialog.getByLabel('Escucha de la transición');
  await expect(audio).toBeVisible({ timeout: 30000 });
  // 10 s, the 6 s cross, 10 s.
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 10000 }).toBeCloseTo(26, 0);
  await expectAccessible(page);
  await dialog.getByLabel('Corte seco').check();
  await dialog.getByRole('button', { name: 'Aplicar' }).click();
  await expect(mix(page).getByRole('button', { name: 'Corte seco antes de c.wav' })).toBeVisible();
  await expect(mix(page)).toContainText('3 pistas · 0:54');
});

test('dragging a clip reorders the mix', async ({ page }) => {
  await filled(page);
  const first = mix(page).locator('.mix-clip').first();
  const last = mix(page).locator('.mix-clip').last();
  const from = (await first.boundingBox())!;
  const to = (await last.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x + to.width - 10 - from.x) * i) / 10, from.y + 10);
  await page.mouse.up();
  await expect(mix(page).locator('.mix-clip-name')).toHaveText(['b.wav', 'c.wav', 'a.wav']);
  await page.keyboard.press('Control+z');
  await expect(mix(page).locator('.mix-clip-name')).toHaveText(['a.wav', 'b.wav', 'c.wav']);
});

test('saves the times as CSV and generates a matched MP3', async ({ page }) => {
  await filled(page);
  const csv = page.waitForEvent('download');
  await mix(page).getByRole('button', { name: 'Tiempos CSV' }).click();
  const c = await csv;
  expect(c.suggestedFilename()).toBe('mezcla.csv');
  expect(await readFile(await c.path(), 'utf8')).toBe('n,start,title\n1,0:00.000,a\n2,0:14.000,b\n3,0:28.000,c\n');

  await mix(page).getByLabel('Igualar volumen', { exact: true }).check();
  await mix(page).getByRole('button', { name: 'MP3' }).click();
  const download = page.waitForEvent('download', { timeout: 90000 });
  await mix(page).getByRole('button', { name: 'Generar mezcla' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('mezcla.mp3');
  const bytes = await readFile(await d.path());
  expect(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)).toBe(true);
});

test('plays the mix, seeks with the ruler, and the fades follow while it plays', { tag: '@a11y' }, async ({ page }) => {
  await filled(page);
  const transport = mix(page).locator('.mix-transport');
  const ruler = mix(page).getByRole('slider', { name: 'Posición en la mezcla' });
  // a.wav 0-20, b.wav 14-34, c.wav 28-48: at 15 s, 1 s into the first 6 s cross.
  await ruler.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(transport).toHaveAttribute('data-time', '15.00');
  await expect(transport).toHaveAttribute('data-gains', '0:0.833 1:0.167');
  await expect(ruler).toHaveAttribute('aria-valuetext', '0:15.000');

  // The mix's fade in, heard as soon as it changes.
  await page.keyboard.press('Home');
  await expect(transport).toHaveAttribute('data-gains', '0:1.000');
  await mix(page).getByLabel('Fundido de inicio').fill('10');
  await mix(page).getByLabel('Fundido de inicio').press('Tab');
  await ruler.focus();
  await page.keyboard.press('ArrowRight');
  await expect(transport).toHaveAttribute('data-gains', '0:0.500');
  await expectAccessible(page);

  // Playing from 10 s goes through the cross into b.wav, with an element per clip heard.
  await page.keyboard.press('ArrowRight');
  await mix(page).getByRole('button', { name: 'Reproducir la mezcla' }).click();
  await expect(mix(page).getByRole('button', { name: 'Pausar la mezcla' })).toBeVisible();
  await expect(transport).toHaveAttribute('data-voices', '1', { timeout: 10000 });
  await expect(transport).toHaveAttribute('data-gains', /^0:\S+ 1:\S+$/, { timeout: 10000 });
  await expect(transport).toHaveAttribute('data-voices', '2', { timeout: 5000 });
  await expect(mix(page).locator('.mix-track .mix-item').nth(1)).toHaveClass(/playing/, { timeout: 10000 });
  await mix(page).getByRole('button', { name: 'Pausar la mezcla' }).click();
  await expect(transport).toHaveAttribute('data-voices', '0');
  const paused = Number(await transport.getAttribute('data-time'));
  expect(paused).toBeGreaterThan(14);

  // Space plays from a clip too, and the editor playing pauses the mix.
  await mix(page).locator('.mix-clip').first().focus();
  await page.keyboard.press('Space');
  await expect(mix(page).getByRole('button', { name: 'Pausar la mezcla' })).toBeVisible();
  await page.getByRole('region', { name: 'Editor' }).getByRole('button', { name: 'Reproducir' }).click();
  await expect(mix(page).getByRole('button', { name: 'Reproducir la mezcla' })).toBeVisible();
});

test('zooms the strip with the buttons and with Ctrl and the wheel', async ({ page }) => {
  await filled(page);
  const ruler = mix(page).getByRole('slider', { name: 'Posición en la mezcla' });
  // The width the mix takes at this zoom; the ruler itself is never narrower than the panel.
  const width = () => ruler.evaluate((el: HTMLElement) => parseFloat(el.style.width));
  const whole = await width();
  await expect(mix(page).getByRole('button', { name: 'Ver toda la mezcla' })).toBeDisabled();
  await mix(page).getByRole('button', { name: 'Acercar la mezcla' }).click();
  await expect.poll(width).toBeCloseTo(whole * 2, 0);
  await mix(page).getByRole('button', { name: 'Ver toda la mezcla' }).click();
  await expect.poll(width).toBeCloseTo(whole, 0);

  const box = (await mix(page).locator('.mix-strip').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(width).toBeGreaterThan(whole * 1.2);
  // The strip scrolls now, and the time under the pointer stays near it.
  expect(await mix(page).locator('.mix-strip').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('lists the clips, opens a transition and the options, and moves a clip by keyboard', { tag: '@a11y' }, async ({ page }) => {
    await open(page);
    await threeTracks(page);
    await page.getByRole('button', { name: 'Mezcla' }).click();
    await expect(page.getByRole('button', { name: 'Añadir selección' })).toBeEnabled({ timeout: 30000 });
    await page.getByRole('button', { name: 'Añadir selección' }).click();
    await expect(mix(page).locator('.mix-clip-name')).toHaveText(['a.wav', 'b.wav', 'c.wav']);
    const position = mix(page).getByRole('slider', { name: 'Posición en la mezcla' });
    await position.fill('30');
    await expect(mix(page).locator('.mix-transport')).toHaveAttribute('data-time', '30.00');
    await expect(mix(page).locator('.mix-item').nth(2)).toHaveClass(/playing/);
    await mix(page).getByRole('button', { name: 'Transición: 6 s' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Transición' })).toBeVisible();
    await page.keyboard.press('Escape');
    await mix(page).getByRole('button', { name: 'Opciones de la mezcla' }).click();
    const sheet = page.getByRole('dialog', { name: 'Opciones de la mezcla' });
    await expect(sheet.getByLabel('Fundido cruzado')).toHaveValue('6');
    await expectAccessible(page);
    await sheet.getByRole('button', { name: 'Listo' }).click();
    await mix(page).locator('.mix-clip').first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(mix(page).locator('.mix-clip-name')).toHaveText(['b.wav', 'a.wav', 'c.wav']);
    await expect(mix(page).locator('.mix-clip').nth(1)).toBeFocused();
    await expectAccessible(page);
  });
});
