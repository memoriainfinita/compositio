import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Isolation and an update each wait up to 15 s; beside the editor's ffmpeg tests they need the room.
test.describe.configure({ timeout: 60_000 });

async function isolatedPage(page: Page, url = './') {
  await page.goto(url);
  // First visit: the service worker takes control and the page reloads once with the headers.
  // waitForFunction keeps polling across that reload.
  await page.waitForFunction(() => self.crossOriginIsolated, null, { timeout: 15000 });
  await page.waitForLoadState('load');
  await page.evaluate(() => navigator.serviceWorker.ready);
}

test('first visit ends cross-origin isolated after exactly one reload', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await isolatedPage(page);
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
  await page.waitForTimeout(3000);
  expect(loads).toBe(2);
});

test('works offline after the first visit, ffmpeg core included once fetched', async ({ page, context }) => {
  await isolatedPage(page);
  const core = await page.evaluate(async () => {
    const res = await fetch('./ffmpeg/core-0.12.10/ffmpeg-core.wasm');
    return { ok: res.ok, bytes: (await res.arrayBuffer()).byteLength };
  });
  expect(core).toEqual({ ok: true, bytes: 32232419 });

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  const offlineCore = await page.evaluate(async () => (await fetch('./ffmpeg/core-0.12.10/ffmpeg-core.wasm')).ok);
  expect(offlineCore).toBe(true);
  await context.setOffline(false);
});

test.describe('updates', () => {
  // Playwright cannot intercept the service worker script in Firefox, so this test serves dist
  // itself and changes sw.js the way a new deploy would.
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
  let server: Server;
  let swSuffix = '';
  // A deploy replaces the hashed assets: the old ones are gone from the server.
  let oldAssetsGone = false;
  const port = 4175;

  test.beforeAll(async () => {
    server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[\\/]+/, '') || 'index.html';
      try {
        if (oldAssetsGone && path.startsWith('assets')) throw new Error('gone');
        let body: Buffer | string = await readFile(join('dist', path));
        if (path === 'sw.js') body = `${body}\n${swSuffix}`;
        res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  });

  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const banner = (page: Page) => page.getByRole('button', { name: 'Nueva versión: recargar' });

  test.afterEach(() => {
    swSuffix = '';
    oldAssetsGone = false;
  });

  test('a new version waits until the user accepts it', async ({ page }) => {
    await isolatedPage(page, `http://127.0.0.1:${port}/`);
    swSuffix = '// next version';
    await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.update()));

    await expect(banner(page)).toBeVisible({ timeout: 15000 });
    // Nothing changes until the click: the old worker still controls the page.
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting))).toBe(true);

    await Promise.all([page.waitForEvent('load'), banner(page).click()]);
    await expect.poll(() => page.evaluate(() => self.crossOriginIsolated)).toBe(true);
    await expect(banner(page)).toBeHidden();
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting))).toBe(false);
  });

  test('reloading without accepting keeps the old version working from its cache', async ({ page }) => {
    await isolatedPage(page, `http://127.0.0.1:${port}/`);
    swSuffix = '// next version';
    await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.update()));
    await expect(banner(page)).toBeVisible({ timeout: 15000 });

    oldAssetsGone = true;
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.app === 'ready', null, { timeout: 10000 });
    await expect(banner(page)).toBeVisible();
  });
});
