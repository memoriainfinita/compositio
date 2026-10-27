// Service worker: isolation headers for multithreaded ffmpeg.wasm, offline app shell,
// ffmpeg cores cached by version, and updates that wait until the user accepts them.
import { cachesToDelete, ffmpegCacheName, routeFor, shellCacheName, withIsolation } from './logic';

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
      .then((names) => Promise.all(cachesToDelete(names, [SHELL, FFMPEG]).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, self.registration.scope, precache);
  if (route === 'ignore') return;
  // The page gets its policy as a header too: only a header can forbid framing it.
  const extra: Record<string, string> = route === 'navigation' ? { 'Content-Security-Policy': __CSP__ } : {};
  event.respondWith(respond(event.request, route).then((r) => withIsolation(r, extra)));
});

async function respond(request: Request, route: string): Promise<Response> {
  if (route === 'navigation') {
    const cached = await caches.match(scopeUrl('index.html'), { cacheName: SHELL });
    return cached ?? fetch(request);
  }
  if (route === 'shell') {
    return (await caches.match(request, { cacheName: SHELL })) ?? fetch(request);
  }
  if (route === 'ffmpeg') {
    const cache = await caches.open(FFMPEG);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }
  return fetch(request);
}
