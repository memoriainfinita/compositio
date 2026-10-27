import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Step 6 on the production build: choosing, dropping files and folders, the list, removing and
// undoing, alerts, a restored session with a missing file, the engine download. The WAVs are made
// here; ffmpeg.wasm probes them for real.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 1440, height: 900 } });

/** A mono 16-bit WAV of a quiet tone: 8 kHz keeps it small. */
function wav(seconds: number, rate = 8000): Buffer {
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}

type Spec = { name: string; data: Buffer; type?: string; path?: string };
const audio = (name: string, seconds: number, path?: string): Spec => ({ name, data: wav(seconds), type: 'audio/wav', path });

async function open(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 20000 });
}

async function choose(page: Page, specs: Spec[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Elegir archivos' }).click();
  await (await chooser).setFiles(specs.map((s) => ({ name: s.name, mimeType: s.type ?? 'application/octet-stream', buffer: s.data })));
}

/** A real drop: Firefox's own DataTransfer, its entries included. */
async function drop(page: Page, specs: Spec[]) {
  const payload = specs.map((s) => ({ name: s.name, type: s.type ?? '', bytes: s.data.toString('base64') }));
  await page.evaluate((items) => {
    const data = new DataTransfer();
    // A fixed date: dropping the same file again must look like the same file.
    for (const i of items) data.items.add(new File([Uint8Array.from(atob(i.bytes), (c) => c.charCodeAt(0))], i.name, { type: i.type, lastModified: 1 }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, payload);
}

/**
 * A dropped folder. Pages cannot build directory entries, so these are shaped like the browser's
 * (`webkitGetAsEntry`, `createReader`, chunked `readEntries`) and go through the app's own walk.
 */
async function dropFolder(page: Page, specs: Spec[]) {
  const payload = specs.map((s) => ({ path: s.path ?? s.name, bytes: s.data.toString('base64') }));
  await page.evaluate((items) => {
    type Node = { name: string; children?: Map<string, Node>; file?: File };
    const root: Node = { name: '', children: new Map() };
    for (const i of items) {
      const parts = i.path.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.children!.has(part)) node.children!.set(part, { name: part, children: new Map() });
        node = node.children!.get(part)!;
      }
      const name = parts.at(-1)!;
      // Equal name, size and date in two subfolders: still two files.
      node.children!.set(name, { name, file: new File([Uint8Array.from(atob(i.bytes), (c) => c.charCodeAt(0))], name, { type: 'audio/wav', lastModified: 1 }) });
    }
    const entry = (node: Node, path: string): unknown =>
      node.file
        ? { isFile: true, isDirectory: false, fullPath: path, file: (ok: (f: File) => void) => ok(node.file!) }
        : {
            isFile: false,
            isDirectory: true,
            fullPath: path,
            createReader: () => {
              // One entry per call, as a browser may hand out a big folder in chunks.
              const left = [...node.children!.values()].map((c) => [entry(c, `${path}/${c.name}`)]);
              return { readEntries: (ok: (e: unknown[]) => void) => ok(left.shift() ?? []) };
            },
          };
    const top = [...root.children!.values()];
    const data = {
      types: ['Files'],
      files: [],
      items: top.map((n) => ({ kind: 'file', webkitGetAsEntry: () => entry(n, `/${n.name}`) })),
      dropEffect: 'none',
    };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const e = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: data });
      window.dispatchEvent(e);
    }
  }, payload);
}

const files = (page: Page) => page.getByRole('complementary', { name: 'Archivos' });
const titles = (page: Page) => files(page).locator('.file-title');

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('chooses files: natural order, durations, batch, active file and its technical line', async ({ page }) => {
  await open(page);
  await choose(page, [audio('Pista 10.wav', 3), audio('Pista 2.wav', 65), audio('Pista 1.wav', 1.4)]);
  await expect(titles(page)).toHaveText(['Pista 1.wav', 'Pista 2.wav', 'Pista 10.wav'], { timeout: 30000 });
  await expect(files(page).locator('.file-duration')).toHaveText(['0:01', '1:05', '0:03']);
  await expect(files(page).getByText('3 de 3')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText('Pista 1.wav');
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText('WAV · 8 kHz · 16 bit · mono');

  await files(page).getByRole('button', { name: 'Pista 10.wav' }).click();
  await expect(files(page).getByRole('button', { name: 'Pista 10.wav' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText('Pista 10.wav');
  await expectAccessible(page);
});

test('drops files and a folder with subfolders, and skips what is already there', async ({ page }) => {
  await open(page);
  await drop(page, [audio('b.wav', 1), audio('a.wav', 1)]);
  await expect(titles(page)).toHaveText(['a.wav', 'b.wav'], { timeout: 30000 });

  await dropFolder(page, [audio('01.wav', 1, 'Show/Acto 2/01.wav'), audio('02.wav', 1, 'Show/Acto 1/02.wav'), audio('01.wav', 1, 'Show/Acto 10/01.wav')]);
  // Each batch goes at the end, ordered by its path: Acto 1, Acto 2, Acto 10.
  await expect(titles(page)).toHaveText(['a.wav', 'b.wav', '02.wav', '01.wav', '01.wav'], { timeout: 30000 });

  await drop(page, [audio('a.wav', 1)]);
  await expect(page.locator('[aria-live]')).toHaveText('1 archivo ya estaba en la lista');
  await expect(titles(page)).toHaveCount(5);
});

test('selection and counter, removing and undoing', async ({ page }) => {
  await open(page);
  await choose(page, [audio('1.wav', 1), audio('2.wav', 1), audio('3.wav', 1)]);
  await expect(titles(page)).toHaveCount(3, { timeout: 30000 });

  const all = files(page).getByRole('checkbox', { name: 'Todos al lote' });
  await files(page).getByRole('checkbox', { name: 'Incluir 2.wav en el lote' }).uncheck();
  await expect(files(page).getByText('2 de 3')).toBeVisible();
  expect(await all.evaluate((e: HTMLInputElement) => e.indeterminate)).toBe(true);
  // A partly ticked box takes all first, then none.
  await all.check();
  await expect(files(page).getByText('3 de 3')).toBeVisible();
  await all.uncheck();
  await expect(files(page).getByText('0 de 3')).toBeVisible();
  await expect(files(page).getByRole('button', { name: 'Quitar' })).toBeDisabled();
  await all.check();

  await files(page).getByRole('checkbox', { name: 'Incluir 2.wav en el lote' }).uncheck();
  await files(page).getByRole('button', { name: 'Quitar' }).click();
  await expect(titles(page)).toHaveText(['2.wav']);
  await expect(page.locator('[aria-live]')).toHaveText('2 archivos quitados');
  await page.keyboard.press('Control+z');
  await expect(titles(page)).toHaveText(['1.wav', '2.wav', '3.wav']);
  // Removed and undone: the files are back, not missing.
  await expect(files(page).getByText('Falta el archivo')).toHaveCount(0);
});

test('alerts about what was not added, and they can be closed', async ({ page }) => {
  await open(page);
  await choose(page, [audio('bien.wav', 1), { name: 'notas.txt', data: Buffer.from('hola'), type: 'text/plain' }, { name: 'roto.mp3', data: Buffer.alloc(4096, 7), type: 'audio/mpeg' }]);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('2 archivos no se han añadido', { timeout: 30000 });
  await expect(alert).toContainText('notas.txt, roto.mp3');
  await expect(titles(page)).toHaveText(['bien.wav']);
  await expectAccessible(page);
  await alert.getByRole('button', { name: 'Cerrar aviso' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('alerts on the start screen when nothing could be added', async ({ page }) => {
  await open(page);
  await choose(page, [{ name: 'notas.txt', data: Buffer.from('hola'), type: 'text/plain' }]);
  await expect(page.getByRole('alert')).toContainText('1 archivo no se ha añadido');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Soltar audios, vídeos o una carpeta');
});

test('a restored session shows the missing file and pairs it when it is dropped', async ({ page }) => {
  const obertura = audio('01 - Obertura.wav', 2);
  await open(page);
  await page.evaluate(async (size) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('compositio', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const session = { format: 'compositio.montage', version: 1, name: 'Ensayo', files: [{ id: 'a', name: '01 - Obertura.wav', size, duration: 192 }] };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(session, 'session');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, obertura.data.length);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');

  await expect(files(page).getByText('Falta el archivo')).toBeVisible();
  await expect(files(page).locator('.file-duration')).toHaveText(['3:12']);
  await expect(files(page).getByRole('checkbox', { name: 'Incluir 01 - Obertura.wav en el lote' })).toBeDisabled();
  await expect(files(page).getByText('0 de 1')).toBeVisible();
  await expectAccessible(page);

  await drop(page, [obertura]);
  await expect(page.locator('[aria-live]')).toHaveText('1 archivo que faltaba encontrado', { timeout: 30000 });
  await expect(files(page).getByText('Falta el archivo')).toHaveCount(0);
  await expect(titles(page)).toHaveText(['01 - Obertura.wav']);
  // The file's own duration replaces the saved one.
  await expect(files(page).locator('.file-duration')).toHaveText(['0:02']);
  await expect(files(page).getByText('1 de 1')).toBeVisible();
});

test('shows the engine download in megabytes on the start screen', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __meters: seen });
    new MutationObserver(() => {
      for (const m of document.querySelectorAll('.meter')) seen.push(m.textContent ?? '');
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await open(page);
  await page.waitForFunction(() => document.documentElement.dataset.engine === 'ready', null, { timeout: 30000 });
  const seen = await page.evaluate(() => (window as unknown as { __meters: string[] }).__meters);
  expect(seen.some((s) => /^Cargando motor de audio\s*\d+ \/ 31 MB$/.test(s.trim()))).toBe(true);
  await expect(page.locator('.meter')).toHaveCount(0);
});
