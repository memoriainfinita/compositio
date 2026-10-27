// Pure parts of the service worker, kept apart so they can be unit tested.

// GitHub Pages sends no COOP/COEP, and SharedArrayBuffer (multithreaded ffmpeg.wasm) needs them.
// The service worker adds them to every response it serves.
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// Every cache this app owns starts with this. Other apps on the same github.io origin share
// CacheStorage, so cleanup must never touch a name without it.
export const CACHE_PREFIX = 'compositio-';

export function shellCacheName(version: string): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

export function ffmpegCacheName(cores: string): string {
  return `${CACHE_PREFIX}ffmpeg-${cores}`;
}

export function cachesToDelete(existing: readonly string[], keep: readonly string[]): string[] {
  return existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.includes(name));
}

/** `extra` adds headers for this response only, such as the page's Content Security Policy. */
export function withIsolation(response: Response, extra: Readonly<Record<string, string>> = {}): Response {
  // Opaque responses cannot be rebuilt; they would be blocked by COEP anyway.
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries({ ...ISOLATION_HEADERS, ...extra })) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Files shared to the app wait here until the page takes them. */
export const SHARE_CACHE = `${CACHE_PREFIX}share`;
/** Where the manifest's share target posts, relative to the scope. */
export const SHARE_PATH = 'share';
/** The page the share target redirects to; the page reads the shared files when it sees it. */
export const SHARE_QUERY = 'share';

export type Route = 'navigation' | 'shell' | 'ffmpeg' | 'network' | 'share' | 'ignore';

/** Decides how the service worker answers a request. `precache` holds paths relative to the scope. */
export function routeFor(request: { url: string; method: string; mode: string }, scope: string, precache: ReadonlySet<string>): Route {
  const url = new URL(request.url);
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return 'ignore';
  const path = url.pathname.slice(base.pathname.length);
  if (request.method === 'POST' && path === SHARE_PATH) return 'share';
  if (request.method !== 'GET') return 'ignore';
  if (request.mode === 'navigate') return 'navigation';
  if (path.startsWith('ffmpeg/')) return 'ffmpeg';
  if (precache.has(path)) return 'shell';
  return 'network';
}
