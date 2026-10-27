import { describe, expect, it } from 'vitest';
import { media } from '../model/fixtures.ts';
import { computePeaks, emptyPeaks, parts, PEAK_RATE, PEAK_SOURCE_RATE, reduceInto } from './peaks.ts';
import type { RunRequest, Runner } from './runner.ts';

describe('peaks', () => {
  it('folds samples into minimum and maximum pairs', () => {
    const p = emptyPeaks(1, 2);
    reduceInto(p, Float32Array.from([0.1, -0.5, 0.3, 0.9, -0.2, 0]), 3, 0);
    expect([...p.min]).toEqual([-0.5, -0.2].map(Math.fround));
    expect([...p.max]).toEqual([0.3, 0.9].map(Math.fround));
  });

  it('writes from an offset and never past the end', () => {
    const p = emptyPeaks(1, 3);
    reduceInto(p, Float32Array.from([0.5, 0.5, 0.5, 0.5]), 1, 2);
    expect([...p.max]).toEqual([0, 0, 0.5]);
  });

  it('splits the duration into parts', () => {
    expect(parts(1300, 600)).toEqual([
      { start: 0, length: 600 },
      { start: 600, length: 600 },
      { start: 1200, length: 100 },
    ]);
    expect(parts(0)).toEqual([]);
  });

  it('decodes part by part and reports each one', async () => {
    const requests: RunRequest[] = [];
    const runner: Runner = {
      async run(req) {
        requests.push(req);
        const seconds = Number(req.args[req.args.indexOf('-t') + 1]);
        const samples = new Float32Array(Math.round(seconds * PEAK_SOURCE_RATE)).fill(0.25);
        return { code: 0, log: [], files: new Map([['peaks.f32', new Blob([samples])]]) };
      },
      dispose() {},
    };
    const info = media({ duration: 700 });
    const seen: number[] = [];
    const p = await computePeaks(runner, new File(['x'], 'a.wav'), info, 0, (x) => seen.push(x.ready));
    expect(seen).toEqual([600, 700]);
    expect(requests[1]!.args).toContain('600.000000');
    expect(requests[0]!.args.join(' ')).toContain('-map 0:a:0 -ac 1 -ar 16000');
    expect(p.max.length).toBe(700 * PEAK_RATE);
    expect(p.max[699 * PEAK_RATE]).toBe(0.25);
  });
});
