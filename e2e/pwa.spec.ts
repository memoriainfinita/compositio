import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Step 11 on the production build: the manifest and its icons, sharing to the app through the
// service worker, «Probar con un ejemplo», «Acerca de» with «Informar de un error», and the
// new-version notice on phones.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, path = './') {
  await page.goto(path);
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 20000 });
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('serves a manifest with its icons and a share target', async ({ page }) => {
  await open(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await page.evaluate(async (url) => (await fetch(url!)).json(), href);
  expect(manifest).toMatchObject({ display: 'standalone', start_url: './', share_target: { action: './share', method: 'POST' } });
  const types = await page.evaluate(
    async (icons: { src: string }[]) => Promise.all(icons.map(async (i) => (await fetch(new URL(i.src, new URL('manifest.webmanifest', location.href)))).headers.get('content-type'))),
    manifest.icons,
  );
  expect(types).toEqual(['image/svg+xml', 'image/png', 'image/png', 'image/png', 'image/png']);
});

test('files shared from another app come in as if dropped', async ({ page }) => {
  await open(page);
  // The preview server isolates the page itself; the share target needs the worker in control.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const n = 8000;
    const b = new DataView(new ArrayBuffer(44 + n * 2));
    [...'RIFF'].forEach((c, i) => b.setUint8(i, c.charCodeAt(0)));
    b.setUint32(4, 36 + n * 2, true);
    [...'WAVEfmt '].forEach((c, i) => b.setUint8(8 + i, c.charCodeAt(0)));
    b.setUint32(16, 16, true);
    b.setUint16(20, 1, true);
    b.setUint16(22, 1, true);
    b.setUint32(24, 8000, true);
    b.setUint32(28, 16000, true);
    b.setUint16(32, 2, true);
    b.setUint16(34, 16, true);
    [...'data'].forEach((c, i) => b.setUint8(36 + i, c.charCodeAt(0)));
    b.setUint32(40, n * 2, true);
    const form = new FormData();
    form.append('media', new File([b.buffer], 'compartido.wav', { type: 'audio/wav' }));
    // The way Android delivers it: a POST to the share target, answered by the service worker.
    const r = await fetch('./share', { method: 'POST', body: form });
    if (!r.redirected) throw new Error(`no redirect: ${r.status} ${r.url} ${!!navigator.serviceWorker.controller} ${(await r.text()).slice(0, 80)}`);
  });
  await open(page, './?share');
  await expect(page.locator('.file-title')).toHaveText(['compartido.wav'], { timeout: 30000 });
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => caches.has('compositio-share'))).toBe(false);
});

test('«Probar con un ejemplo» brings three tracks into the files and the mix', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
  await expect(page.locator('.file-title')).toHaveText(['01 - Amanecer.wav', '02 - Paseo.wav', '03 - Final.wav'], { timeout: 30000 });
  await expect(page.getByRole('region', { name: 'Mezcla' })).toContainText('3 pistas · 0:48');
});

test('«Acerca de» links to the code and copies the details for an issue', async ({ page, context }) => {
  await open(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.getByRole('button', { name: 'Acerca de' }).click();
  const dialog = page.getByRole('dialog', { name: 'Acerca de compositio' });
  await expect(dialog).toContainText('GPL-3.0');
  await expect(dialog.getByRole('link', { name: 'Código de compositio' })).toHaveAttribute('href', 'https://github.com/memoriainfinita/compositio');
  await expect(dialog.getByRole('link', { name: 'Código de ffmpeg.wasm' })).toHaveAttribute('href', 'https://github.com/ffmpegwasm/ffmpeg.wasm');
  await expect(dialog.getByRole('link', { name: 'Abrir una incidencia' })).toHaveAttribute('href', /issues\/new$/);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Copiar detalles' }).click();
  const status = dialog.getByRole('status');
  await expect(status).toHaveText(/Detalles copiados|No se han podido copiar/);
  // Whichever way it went, the details are there to take.
  if ((await status.textContent())?.startsWith('No')) await expect(dialog.getByLabel('Detalles técnicos')).toHaveValue(/^compositio \d/);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the new-version notice stays above the bottom bar', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
    await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 30000 });
    // The notice as the app shows it, placed by the same stylesheet.
    const [banner, nav] = await page.evaluate(() => {
      const b = document.createElement('div');
      b.className = 'update-banner';
      b.textContent = 'x';
      document.querySelector('.workspace')!.after(b);
      return [b.getBoundingClientRect().bottom, document.querySelector('.bottom-nav')!.getBoundingClientRect().top];
    });
    expect(banner).toBeLessThanOrEqual(nav);
    await page.evaluate(() => document.querySelector('.update-banner')?.remove());
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expectAccessible(page);
  });
});
