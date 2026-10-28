import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Step 7 on the production build: the waveform in parts, the region by keys, handles and fields,
// undo, A/B, a file Firefox cannot play (AIFF) and a video with its picture. Everything stays silent:
// besides the muted media pref, whatever Web Audio sends out goes through a zero gain first.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 1440, height: 900 } });

/** A mono 16-bit tone at 8 kHz, little-endian (WAV) or big-endian (AIFF). */
function pcm(seconds: number, rate: number, bigEndian: boolean): Buffer {
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate));
    if (bigEndian) b.writeInt16BE(v, i * 2);
    else b.writeInt16LE(v, i * 2);
  }
  return b;
}

function wav(seconds: number, rate = 8000): Buffer {
  const data = pcm(seconds, rate, false);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** AIFF: ffmpeg reads it, Firefox does not play it. The rate is an 80-bit extended float. */
function aiff(seconds: number, rate = 8000): Buffer {
  const data = pcm(seconds, rate, true);
  const comm = Buffer.alloc(26);
  comm.write('COMM', 0);
  comm.writeUInt32BE(18, 4);
  comm.writeUInt16BE(1, 8);
  comm.writeUInt32BE(data.length / 2, 10);
  comm.writeUInt16BE(16, 14);
  const exp = Math.floor(Math.log2(rate));
  comm.writeUInt16BE(16383 + exp, 16);
  comm.writeUInt32BE(Math.round(rate * 2 ** (31 - exp)), 18);
  const ssnd = Buffer.alloc(16);
  ssnd.write('SSND', 0);
  ssnd.writeUInt32BE(8 + data.length, 4);
  const form = Buffer.alloc(12);
  form.write('FORM', 0);
  form.writeUInt32BE(4 + comm.length + ssnd.length + data.length, 4);
  form.write('AIFF', 8);
  return Buffer.concat([form, comm, ssnd, data]);
}

async function open(page: Page) {
  // Web Audio's way out goes through a silent gain: the tests play sound, nobody hears it.
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

async function choose(page: Page, name: string, data: Buffer, mimeType = 'audio/wav') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Elegir archivos' }).click();
  await (await chooser).setFiles([{ name, mimeType, buffer: data }]);
}

const editor = (page: Page) => page.getByRole('region', { name: 'Editor' });
const slider = (page: Page, name: string) => editor(page).getByRole('slider', { name, exact: true });
const field = (page: Page, name: string) => editor(page).getByRole('textbox', { name, exact: true });

async function ready(page: Page) {
  await expect(editor(page).locator('.wave')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('draws the waveform and sets the region with I, O and the arrows; undo takes it back', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await choose(page, 'tono.wav', wav(12));
  await ready(page);
  // The wave is drawn: the canvas holds more than its background.
  const colours = await editor(page)
    .locator('.wave canvas')
    .evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
      return seen.size;
    });
  expect(colours).toBeGreaterThan(1);

  const position = slider(page, 'Posición');
  await position.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(position).toHaveAttribute('aria-valuenow', '3.000');
  await page.keyboard.press('i');
  await expect(field(page, 'Entrada')).toHaveValue('0:03.000');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('o');
  await expect(field(page, 'Salida')).toHaveValue('0:12.000');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('o');
  await expect(field(page, 'Salida')).toHaveValue('0:10.000');
  await expect(slider(page, 'Región')).toHaveAttribute('aria-valuetext', '0:03.000 – 0:10.000');

  await page.keyboard.press('Control+z');
  await expect(field(page, 'Salida')).toHaveValue('0:12.000');
  await expect(field(page, 'Entrada')).toHaveValue('0:03.000');

  // A handle by keys: 10 ms, 100 ms with Shift.
  await slider(page, 'Entrada').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(field(page, 'Entrada')).toHaveValue('0:03.110');

  // Zoom keys on the waveform; 0 shows everything again.
  await position.focus();
  await page.keyboard.press('ArrowUp');
  await expect(editor(page).locator('.overview-window')).toBeVisible();
  await page.keyboard.press('0');
  await expect(editor(page).locator('.overview-window')).toHaveCount(0);
  await expectAccessible(page);
});

test('drags the handles and the region, each drag one undo step', async ({ page }) => {
  await open(page);
  await choose(page, 'tono.wav', wav(10));
  await ready(page);
  const box = (await editor(page).locator('.wave').boundingBox())!;
  const at = (s: number) => box.x + (box.width * s) / 10;

  const handle = (await slider(page, 'Entrada').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(1), box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(at(2), box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(field(page, 'Entrada')).toHaveValue(/^0:0(1\.9|2\.0)/);

  const out = (await slider(page, 'Salida').boundingBox())!;
  await page.mouse.move(out.x + out.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(6), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(field(page, 'Salida')).toHaveValue(/^0:0(5\.9|6\.0)/);

  // The region bar moves both ends together.
  const region = (await slider(page, 'Región').boundingBox())!;
  await page.mouse.move(region.x + region.width / 2, region.y + region.height / 2);
  await page.mouse.down();
  await page.mouse.move(region.x + region.width / 2 + (box.width * 2) / 10, region.y + region.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(field(page, 'Entrada')).toHaveValue(/^0:0(3\.9|4\.0)/);
  await expect(field(page, 'Salida')).toHaveValue(/^0:0(7\.9|8\.0)/);

  await page.keyboard.press('Control+z');
  await expect(field(page, 'Entrada')).toHaveValue(/^0:0(1\.9|2\.0)/);
  await page.keyboard.press('Control+z');
  await expect(field(page, 'Salida')).toHaveValue('0:10.000');
});

test('fields take typed times and fades; B follows the region and the fades', async ({ page }) => {
  await open(page);
  await choose(page, 'tono.wav', wav(10));
  await ready(page);

  await field(page, 'Entrada').fill('0:02');
  await field(page, 'Entrada').press('Enter');
  await expect(slider(page, 'Entrada')).toHaveAttribute('aria-valuenow', '2');
  await field(page, 'Salida').fill('abc');
  await expect(field(page, 'Salida')).toHaveAttribute('aria-invalid', 'true');
  await field(page, 'Salida').press('Escape');
  await expect(field(page, 'Salida')).toHaveValue('0:10.000');

  await editor(page).getByRole('spinbutton', { name: 'Fundido de entrada' }).fill('2');
  await editor(page).getByRole('spinbutton', { name: 'Fundido de entrada' }).press('Tab');
  await expect(slider(page, 'Fundido de entrada')).toHaveAttribute('aria-valuetext', '2 s');
  await editor(page).getByRole('combobox', { name: 'Fundido de entrada: Curva' }).selectOption('qsin');

  // Paused, the stage reports the gain B would apply where the playhead stands.
  const stage = editor(page).locator('.editor-stage');
  await editor(page).getByRole('button', { name: 'B', exact: true }).click();
  await expect(stage).toHaveAttribute('data-gain', '0.000');
  const position = slider(page, 'Posición');
  await position.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-gain', Math.sin(Math.PI / 4).toFixed(3));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-gain', '1.000');
  await editor(page).getByRole('button', { name: 'A', exact: true }).click();
  await page.keyboard.press('Home');
  await expect(stage).toHaveAttribute('data-gain', '1.000');

  // Playing B from before the region starts at the region.
  await editor(page).getByRole('button', { name: 'B', exact: true }).click();
  await position.focus();
  await page.keyboard.press('Space');
  await expect(editor(page).getByRole('button', { name: 'Pausa' })).toBeVisible();
  await expect.poll(async () => Number(await position.getAttribute('aria-valuenow'))).toBeGreaterThan(2);
  await page.keyboard.press('Space');
  await expect(editor(page).getByRole('button', { name: 'Reproducir' })).toBeVisible();
});

test('a file Firefox cannot play gets a copy to listen to', async ({ page }) => {
  await open(page);
  await choose(page, 'tono.aiff', aiff(4), 'audio/aiff');
  await ready(page);
  await editor(page).getByRole('button', { name: 'Reproducir' }).click();
  await expect(editor(page).locator('audio')).toHaveAttribute('src', /^blob:/);
  // The copy replaces the file's own URL; then playing moves the playhead.
  await expect.poll(async () => editor(page).locator('audio').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 30000 }).toBeGreaterThan(0);
  await editor(page).getByRole('button', { name: 'Reproducir' }).click();
  await expect.poll(async () => Number(await slider(page, 'Posición').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
});

test('a video shows its picture over the waveform', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  // A short WebM with picture and sound, recorded in the page itself.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const g = canvas.getContext('2d')!;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const stream = new MediaStream([...canvas.captureStream(25).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const until = performance.now() + 1500;
    while (performance.now() < until) {
      g.fillStyle = `hsl(${performance.now() % 360} 60% 50%)`;
      g.fillRect(0, 0, 160, 90);
      await new Promise((r) => setTimeout(r, 40));
    }
    rec.stop();
    await done;
    await ctx.close();
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  await choose(page, 'clip.webm', Buffer.from(bytes), 'video/webm');
  await ready(page);
  const video = editor(page).locator('video');
  await expect(video).toBeVisible();
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(160);
  await expectAccessible(page);
});

test('accessible on tablet and phone, with the fades folded on the phone', { tag: '@a11y' }, async ({ page }) => {
  await open(page);
  await choose(page, 'tono.wav', wav(6));
  await ready(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await ready(page);
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(editor(page).getByText('Fundidos', { exact: true })).toBeVisible();
  await expect(editor(page).getByRole('spinbutton', { name: 'Fundido de entrada' })).toBeHidden();
  await expectAccessible(page);
});
