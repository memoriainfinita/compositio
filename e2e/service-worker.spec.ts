import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.locator('h1')).toHaveText('compositio');
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
  const port = 4175;

  test.beforeAll(async () => {
    server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[\\/]+/, '') || 'index.html';
      try {
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

  test('a new version waits until the user accepts it', async ({ page }) => {
    await isolatedPage(page, `http://127.0.0.1:${port}/`);
    swSuffix = '// next version';
    await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.update()));

    await expect(page.locator('#update')).toBeVisible({ timeout: 15000 });
    // Nothing changes until the click: the old worker still controls the page.
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting))).toBe(true);

    await Promise.all([page.waitForEvent('load'), page.locator('#update-apply').click()]);
    await expect.poll(() => page.evaluate(() => self.crossOriginIsolated)).toBe(true);
    await expect(page.locator('#update')).toBeHidden();
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting))).toBe(false);
  });
});
