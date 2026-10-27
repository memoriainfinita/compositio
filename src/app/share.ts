// Files shared to compositio from another app (Android): the service worker left them in a cache
// and opened the app with `?share`. They are taken once and the cache is emptied.

import { SHARE_CACHE, SHARE_QUERY } from '../sw/logic.ts';

export const wasShared = (location: Location = globalThis.location): boolean => new URLSearchParams(location.search).has(SHARE_QUERY);

/** The shared files in the order they came, by their `share/<n>/<name>` key. */
export async function takeShared(storage: CacheStorage = caches): Promise<File[]> {
  if (!(await storage.has(SHARE_CACHE))) return [];
  const cache = await storage.open(SHARE_CACHE);
  const requests = await cache.keys();
  const files = await Promise.all(
    requests.map(async (req) => {
      const match = /\/share\/(\d+)\/([^/]+)$/.exec(new URL(req.url).pathname);
      const res = await cache.match(req);
      if (!match || !res) return null;
      const blob = await res.blob();
      const modified = Date.parse(res.headers.get('Last-Modified') ?? '');
      const file = new File([blob], decodeURIComponent(match[2]!), { type: blob.type, lastModified: Number.isNaN(modified) ? Date.now() : modified });
      return { order: Number(match[1]), file };
    }),
  );
  await storage.delete(SHARE_CACHE);
  return files.flatMap((f) => (f ? [f] : [])).sort((a, b) => a.order - b.order).map((f) => f.file);
}
