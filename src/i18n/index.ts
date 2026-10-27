// Interface languages. Reading `lang` inside a component re-renders it when the language changes.

import { effect, signal } from '@preact/signals';
import { en } from './en.ts';
import { es, type Key, type Messages, type Plural } from './es.ts';

export type Lang = 'es' | 'en';
export const LANGS: readonly Lang[] = ['es', 'en'];
const MESSAGES: Record<Lang, Messages> = { es, en };

/** `auto` takes the first browser language we have, and English when there is none. */
export function resolveLang(setting: 'auto' | Lang, preferred: readonly string[]): Lang {
  if (setting !== 'auto') return setting;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0] as Lang;
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

export const lang = signal<Lang>(resolveLang('auto', globalThis.navigator?.languages ?? []));

type Vars = Record<string, string | number>;

const fill = (text: string, vars: Vars = {}): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));

/** A message; plural messages take their form from `vars.n`. */
export function t(key: Key, vars?: Vars, language: Lang = lang.value): string {
  const message = MESSAGES[language][key] as string | Plural;
  if (typeof message === 'string') return fill(message, vars);
  const n = Number(vars?.n ?? 0);
  const form = new Intl.PluralRules(language).select(n) === 'one' ? message.one : message.other;
  return fill(form, { ...vars, n: formatNumber(n, language) });
}

export const formatNumber = (n: number, language: Lang = lang.value, digits = 0): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

/** Keeps `<html lang>` in step, for screen readers and hyphenation. */
export function bindDocumentLang(doc: Document = document): () => void {
  return effect(() => {
    doc.documentElement.lang = lang.value;
  });
}

export type { Key };
