import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 contrast for every pair of colours the interface puts together, in both themes.
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

const dark = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: light)')));
const light = { ...dark, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: light)'))) };

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const grounds = ['bg', 'bar', 'surface', 'inset'];
// Text: 4.5:1. Accent as text also sits on its own weak tint (selected tabs).
// The active file sits on the weak tint; alerts on their own ground.
const text: [string, string[]][] = [
  ['text', [...grounds, 'accent-weak', 'warn-bg']],
  ['text-2', grounds],
  ['muted', [...grounds, 'accent-weak']],
  ['accent', [...grounds, 'accent-weak']],
  ['on-accent', ['accent']],
  ['warn-text', ['warn-bg']],
];
// Non-text that people must see (field borders, focus ring, own-settings dot): 3:1.
const shapes: [string, string[]][] = [
  ['field-line', grounds],
  ['focus', grounds],
  ['warn', [...grounds, 'warn-bg']],
  ['accent', grounds],
];

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme', (_, t) => {
  it.each(text.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg])))('text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(shapes.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg])))('%s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
