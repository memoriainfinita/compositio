import { describe, expect, it } from 'vitest';
import { download } from './download.ts';

const chunked = (sizes: number[], status = 200): typeof fetch =>
  (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const n of sizes) c.enqueue(new Uint8Array(n));
          c.close();
        },
      }),
      { status },
    )) as typeof fetch;

describe('download', () => {
  it('counts the bytes as they arrive against the size known at build time', async () => {
    const seen: [number, number][] = [];
    await download('core.wasm', 10, (l, t) => seen.push([l, t]), chunked([4, 4, 2]));
    expect(seen).toEqual([
      [0, 10],
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
  });

  it('never shows more loaded than total, and fails on an error status', async () => {
    const seen: [number, number][] = [];
    await download('core.wasm', 5, (l, t) => seen.push([l, t]), chunked([4, 4]));
    expect(seen.at(-1)).toEqual([8, 8]);
    await expect(download('core.wasm', 5, () => {}, chunked([], 404))).rejects.toThrow('404');
  });
});
