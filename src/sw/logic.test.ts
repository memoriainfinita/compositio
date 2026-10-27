import { describe, expect, it } from 'vitest';
import { cachesToDelete, ffmpegCacheName, ISOLATION_HEADERS, routeFor, shellCacheName, withIsolation } from './logic';

const scope = 'https://example.github.io/compositio/';
const precache = new Set(['index.html', 'assets/index-abc.js']);
const req = (path: string, mode = 'cors', method = 'GET', origin = 'https://example.github.io') => ({
  url: `${origin}${path}`,
  mode,
  method,
});

describe('routeFor', () => {
  it('serves navigations from the shell', () => {
    expect(routeFor(req('/compositio/', 'navigate'), scope, precache)).toBe('navigation');
    expect(routeFor(req('/compositio/?x=1', 'navigate'), scope, precache)).toBe('navigation');
  });

  it('separates ffmpeg cores, precached files and the rest', () => {
    expect(routeFor(req('/compositio/ffmpeg/core-0.12.10/ffmpeg-core.wasm'), scope, precache)).toBe('ffmpeg');
    expect(routeFor(req('/compositio/assets/index-abc.js'), scope, precache)).toBe('shell');
    expect(routeFor(req('/compositio/assets/other.js'), scope, precache)).toBe('network');
  });

  it('ignores other origins, other apps on the origin and non-GET requests', () => {
    expect(routeFor(req('/compositio/index.html', 'cors', 'GET', 'https://other.example'), scope, precache)).toBe('ignore');
    expect(routeFor(req('/Spectra-visio/index.html', 'navigate'), scope, precache)).toBe('ignore');
    expect(routeFor(req('/compositio/index.html', 'cors', 'POST'), scope, precache)).toBe('ignore');
  });
});

describe('caches', () => {
  it('deletes only old caches of this app', () => {
    const keep = [shellCacheName('new'), ffmpegCacheName('core-0.12.10+core-mt-0.12.10')];
    const existing = [...keep, shellCacheName('old'), ffmpegCacheName('core-0.12.9'), 'workbox-precache-v2-spectra'];
    expect(cachesToDelete(existing, keep)).toEqual([shellCacheName('old'), ffmpegCacheName('core-0.12.9')]);
  });
});

describe('withIsolation', () => {
  it('adds the isolation headers and keeps status and body', async () => {
    const res = withIsolation(new Response('hi', { status: 201, headers: { 'Content-Type': 'text/plain' } }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('hi');
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });
});
