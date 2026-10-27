import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { es } from './es.ts';
import { formatNumber, resolveLang, t } from './index.ts';

describe('i18n', () => {
  it('takes the first browser language it has', () => {
    expect(resolveLang('auto', ['es-ES', 'en'])).toBe('es');
    expect(resolveLang('auto', ['fr-FR', 'en-GB', 'es'])).toBe('en');
    expect(resolveLang('auto', ['ES-mx'])).toBe('es');
    expect(resolveLang('auto', ['de'])).toBe('en');
    expect(resolveLang('es', ['en'])).toBe('es');
  });

  it('has the same keys and plural shapes in every language', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      expect(typeof en[key], key).toBe(typeof es[key]);
    }
  });

  it('fills variables and picks plural forms', () => {
    expect(t('files.count', { n: 1 }, 'es')).toBe('1 archivo');
    expect(t('files.count', { n: 1200 }, 'es')).toBe('1200 archivos');
    expect(t('files.count', { n: 1200 }, 'en')).toBe('1,200 files');
    expect(t('header.undo', {}, 'en')).toBe('Undo');
  });

  it('formats numbers per language', () => {
    expect(formatNumber(-14.25, 'es', 1)).toBe('-14,3');
    expect(formatNumber(-14.25, 'en', 1)).toBe('-14.3');
  });
});
