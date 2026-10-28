// Service worker: isolation headers for multithreaded ffmpeg.wasm, offline app shell,
// ffmpeg cores cached by version, and updates that wait until the user accepts them.
import { cachesToDelete, ffmpegCacheName, routeFor, SHARE_CACHE, SHARE_QUERY, shellCacheName, withIsolation } from './logic';

declare const self: ServiceWorkerGlobalScope;
// Filled in at build time by build/sw-plugin.ts.
declare const __PRECACHE__: string[];
declare const __VERSION__: string;
declare const __FFMPEG_CORES__: string;
declare const __CSP__: string;

const SHELL = shellCacheName(__VERSION__);
const FFMPEG = ffmpegCacheName(__FFMPEG_CORES__);
const precache = new Set(__PRECACHE__);
const scopeUrl = (path: string) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // 'reload' skips the HTTP cache so index.html and its assets come from the same deploy.
      cache.addAll([...precache].map((path) => new Request(scopeUrl(path), { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(cachesToDelete(names, [SHELL, FFMPEG, SHARE_CACHE]).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, self.registration.scope, precache);
  if (route === 'ignore') return;
  if (route === 'share') return event.respondWith(receiveShare(event.request));
  // The page gets its policy as a header too: only a header can forbid framing it.
  const extra: Record<string, string> = route === 'navigation' ? { 'Content-Security-Policy': __CSP__ } : {};
  event.respondWith(respond(event.request, route, (p) => event.waitUntil(p)).then((r) => withIsolation(r, extra)));
});

/**
 * Files shared from another app (the manifest's share target): stored until the page takes them,
 * then the page opens with `?share`. Each file keeps its name in the cache key.
 */
async function receiveShare(request: Request): Promise<Response> {
  const data = await request.formData().catch(() => null);
  const files = (data?.getAll('media') ?? []).filter((f): f is File => f instanceof File);
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all(
    files.map((f, i) =>
      cache.put(scopeUrl(`share/${i}/${encodeURIComponent(f.name)}`), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Last-Modified': new Date(f.lastModified).toUTCString() } })),
    ),
  );
  return Response.redirect(scopeUrl(`./?${SHARE_QUERY}`), 303);
}

/** Cores being stored: a second request for one waits for it instead of downloading it again. */
const storing = new Map<string, Promise<void>>();

async function respond(request: Request, route: string, later: (p: Promise<unknown>) => void): Promise<Response> {
  // The shell is cached by exact URL. Vary is ignored: with Vary: Origin (vite preview), Chromium's
  // module requests carry an Origin the precache lacked, would miss it and get the new deploy's
  // page from the network instead of the old script.
  if (route === 'navigation') {
    const cached = await caches.match(scopeUrl('index.html'), { cacheName: SHELL, ignoreVary: true });
    return cached ?? fetch(request);
  }
  if (route === 'shell') {
    return (await caches.match(request, { cacheName: SHELL, ignoreVary: true })) ?? fetch(request);
  }
  if (route === 'ffmpeg') {
    const cache = await caches.open(FFMPEG);
    await storing.get(request.url)?.catch(() => {});
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      // The page reads the body as it arrives (the start screen counts its bytes); the copy is
      // stored meanwhile.
      const stored = cache.put(request, response.clone()).finally(() => storing.delete(request.url));
      storing.set(request.url, stored);
      later(stored);
    }
    return response;
  }
  return fetch(request);
}
