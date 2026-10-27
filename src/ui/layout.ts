// Desktop, tablet and phone layouts of the design canvas, chosen by width.

import { signal } from '@preact/signals';

export type Layout = 'mobile' | 'tablet' | 'desktop';

export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1200;

export const layoutFor = (width: number): Layout => (width >= DESKTOP_MIN ? 'desktop' : width >= TABLET_MIN ? 'tablet' : 'mobile');

export const layout = signal<Layout>(layoutFor(globalThis.innerWidth ?? DESKTOP_MIN));

export function watchLayout(win: Window = window): () => void {
  const queries = [`(min-width: ${TABLET_MIN}px)`, `(min-width: ${DESKTOP_MIN}px)`].map((q) => win.matchMedia(q));
  const update = () => (layout.value = layoutFor(win.innerWidth));
  for (const q of queries) q.addEventListener('change', update);
  update();
  return () => queries.forEach((q) => q.removeEventListener('change', update));
}

/** Messages for screen readers: progress, results, errors. */
export const announcement = signal('');

export function announce(message: string): void {
  // Clearing first makes a repeated message be read again.
  announcement.value = '';
  queueMicrotask(() => (announcement.value = message));
}
