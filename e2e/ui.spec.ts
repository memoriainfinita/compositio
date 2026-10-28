import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The interface shell on the production build: layouts, keyboard, accessibility, CSP, languages.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function open(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __csp: seen });
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto('./');
  // First visit: the service worker reloads the page once to isolate it.
  await page.waitForFunction(() => self.crossOriginIsolated && document.documentElement.dataset.app === 'ready', null, { timeout: 20000 });
}

/** A saved session with two files, so the workspace shows instead of the start screen. */
async function openWorkspace(page: Page) {
  await open(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('compositio');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const session = {
      format: 'compositio.montage',
      version: 1,
      name: 'Ensayo',
      files: [
        { id: 'a', name: '01 - Obertura.wav', size: 1000, duration: 192 },
        { id: 'b', name: '02 - Entrada.mp3', size: 2000, duration: 245 },
      ],
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(session, 'session');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.app === 'ready');
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('start screen', () => {
  test('loads the engine under the CSP without a single violation', async ({ page }) => {
    await open(page);
    await page.waitForFunction(() => document.documentElement.dataset.engine === 'ready', null, { timeout: 30000 });
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });

  test('is accessible in this theme', { tag: '@a11y' }, async ({ page }, info) => {
    await open(page);
    // Projects «app» and «app-light» force each theme (playwright.config.ts).
    const background = info.project.name === 'app-light' ? 'rgb(244, 245, 247)' : 'rgb(18, 20, 23)';
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Soltar audios, vídeos o una carpeta');
    await expectAccessible(page);
  });

  test.describe('in English', () => {
    test.use({ locale: 'en-US' });
    test('follows the browser language', async ({ page }) => {
      await open(page);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Drop audio, video or a folder');
    });
  });

  test('skip link takes the keyboard to the content', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });
});

test.describe('desktop workspace', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows files, editor, mix, the five output steps and the queue', { tag: '@a11y' }, async ({ page }) => {
    await openWorkspace(page);
    await expect(page.getByRole('heading', { level: 1, name: 'compositio' })).toBeVisible();
    await expect(page.getByText('Ensayo')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Archivos' }).locator('.file-title')).toHaveText(['01 - Obertura.wav', '02 - Entrada.mp3']);
    await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mezcla' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Salida' }).getByRole('heading', { level: 3 })).toHaveText([
      '1 Extraer audio',
      '2 Recortar',
      '3 Normalizar',
      '4 Convertir',
      '5 Nombre',
    ]);
    await expect(page.getByRole('contentinfo')).toContainText('Nada exportado');
    await expect(page.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    await expectAccessible(page);
  });

  test('montages popup traps focus, closes with Esc and gives the focus back', { tag: '@a11y' }, async ({ page }) => {
    await openWorkspace(page);
    const opener = page.getByRole('button', { name: 'Abrir montaje' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Montajes' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('tablet workspace', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('opens files in a side panel and moves through output tabs with the keyboard', { tag: '@a11y' }, async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Archivos: 2 archivos' }).click();
    const drawer = page.getByRole('dialog', { name: 'Archivos' });
    await expect(drawer.getByRole('listitem')).toHaveCount(2);
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    const first = page.getByRole('tab', { name: '1 Extraer audio' });
    await first.click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '2 Recortar' })).toBeFocused();
    await expect(page.getByRole('tab', { name: '2 Recortar' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: '5 Nombre' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: '1 Extraer audio' })).toContainText('Pista de audio');
    await expectAccessible(page);
  });
});

test.describe('phone workspace', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('switches sections from the bottom bar and shows output as a sheet', { tag: '@a11y' }, async ({ page }) => {
    await openWorkspace(page);
    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('button', { name: 'Archivos' }).click();
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(2);
    await nav.getByRole('button', { name: 'Mezcla' }).click();
    await expect(page.getByRole('heading', { name: 'Mezcla' })).toBeVisible();
    await nav.getByRole('button', { name: 'Exportado' }).click();
    await expect(page.getByRole('main')).toContainText('Nada exportado');
    await nav.getByRole('button', { name: 'Editor' }).click();
    await page.getByRole('button', { name: 'Ajustes de salida' }).click();
    await expect(page.getByRole('dialog', { name: 'Salida' }).getByRole('tab')).toHaveCount(5);
    await expectAccessible(page);
  });

  test('has no horizontal scroll', async ({ page }) => {
    await openWorkspace(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
