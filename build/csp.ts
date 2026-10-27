// Content Security Policy, written once. The build puts it in a <meta> of index.html (GitHub Pages
// sends no headers); the service worker also sends it as a header, which adds frame-ancestors.
import type { Plugin } from 'vite';

const DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // ffmpeg.wasm compiles WebAssembly; nothing else is evaluated.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'img-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'connect-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

const serialize = (d: Record<string, string[]>): string =>
  Object.entries(d)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

/** For the <meta>: browsers ignore frame-ancestors there. */
export const CSP_META = serialize(DIRECTIVES);

/** For the header the service worker adds: no one may frame the app. */
export const CSP_HEADER = serialize({ ...DIRECTIVES, 'frame-ancestors': ["'none'"] });

/** Build only: in dev, Vite injects inline styles that a strict policy would block. */
export function contentSecurityPolicy(): Plugin {
  return {
    name: 'compositio-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP_META}">`),
    },
  };
}
