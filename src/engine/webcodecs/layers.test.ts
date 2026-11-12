import { describe, expect, it } from 'vitest';
import type { MixSegment } from '../../model/mix.ts';
import { layersAt } from './layers.ts';
import { FrameCursor } from './resample.ts';

const seg = (at: number, length: number, overlapIn: number, curve: MixSegment['curve'] = 'tri'): MixSegment => ({ file: 0, picture: null, start: 0, length, at, overlapIn, curve });

describe('layersAt', () => {
  const segs = [seg(0, 10, 0), seg(8, 10, 2), seg(16, 10, 2, 'qsin')];

  it('has one layer where nothing crosses', () => {
    expect(layersAt(segs, 4)).toEqual([{ segment: 0, alpha: 1, within: 4 }]);
    expect(layersAt(segs, 12)).toEqual([{ segment: 1, alpha: 1, within: 4 }]);
  });

  it('draws the incoming clip over the outgoing one with the curve as its opacity', () => {
    expect(layersAt(segs, 9)).toEqual([
      { segment: 0, alpha: 1, within: 9 },
      { segment: 1, alpha: 0.5, within: 1 },
    ]);
    const [, incoming] = layersAt(segs, 17);
    expect(incoming).toMatchObject({ segment: 2, within: 1 });
    expect(incoming!.alpha).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it('hands over at the exact end of the overlap and never shows more than two', () => {
    expect(layersAt(segs, 10).map((l) => l.segment)).toEqual([1]);
    for (let t = 0; t < 26; t += 0.04) expect(layersAt(segs, t).length).toBeLessThanOrEqual(2);
    expect(layersAt(segs, 26)).toEqual([]);
  });

  it('cuts dry: the next clip takes over with no blend', () => {
    const cut = [seg(0, 5, 0), seg(5, 5, 0)];
    expect(layersAt(cut, 4.99).map((l) => l.segment)).toEqual([0]);
    expect(layersAt(cut, 5).map((l) => [l.segment, l.alpha])).toEqual([[1, 1]]);
  });
});

async function* frames(times: number[]): AsyncGenerator<{ timestamp: number }> {
  for (const timestamp of times) yield { timestamp };
}

describe('FrameCursor', () => {
  it('gives the latest frame at or before the time and closes those it passes', async () => {
    const closed: number[] = [];
    const c = new FrameCursor(frames([0, 1, 2, 3]), (f) => closed.push(f.timestamp));
    expect((await c.at(0.5))?.timestamp).toBe(0);
    expect((await c.at(1))?.timestamp).toBe(1);
    expect((await c.at(2.5))?.timestamp).toBe(2);
    expect(closed).toEqual([0, 1]);
    expect((await c.at(10))?.timestamp).toBe(3);
    await c.close();
    expect(closed).toEqual([0, 1, 2, 3]);
  });

  it('is empty for a file with no frames', async () => {
    const c = new FrameCursor(frames([]));
    expect(await c.at(1)).toBeUndefined();
    await c.close();
  });
});
