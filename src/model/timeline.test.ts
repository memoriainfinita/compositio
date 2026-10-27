import { describe, expect, it } from 'vitest';
import { defaultMix, layout, moveItem, timesCsv, type Clip } from './timeline.ts';

const clip = (id: string, transitionIn: Clip['transitionIn'] = null): Clip => ({ id, fileId: `f-${id}`, kind: 'audio', transitionIn });
const lengths = (entries: [string, number][]) => new Map(entries);

describe('layout', () => {
  it('chains clips with the default crossfade', () => {
    const r = layout([clip('a'), clip('b'), clip('c')], lengths([['a', 60], ['b', 60], ['c', 30]]), defaultMix());
    expect(r.placed.map((p) => [p.start, p.end, p.overlapIn])).toEqual([[0, 60, 0], [54, 114, 6], [108, 138, 6]]);
    expect(r.duration).toBe(138);
    expect(r.issues).toEqual([]);
  });

  it('honours a clip transition and a dry cut', () => {
    const mix = defaultMix();
    const r = layout(
      [clip('a'), clip('b', { duration: 10, curve: 'qsin', cut: false }), clip('c', { duration: 10, curve: 'tri', cut: true })],
      lengths([['a', 60], ['b', 60], ['c', 30]]),
      mix,
    );
    expect(r.placed.map((p) => p.start)).toEqual([0, 50, 110]);
  });

  it('shortens an overlap that does not fit and reports it', () => {
    const r = layout([clip('a'), clip('b'), clip('c')], lengths([['a', 60], ['b', 8], ['c', 60]]), defaultMix());
    // b is 8 s: 6 s go into the crossfade with a, so only 2 s are left for c.
    expect(r.issues).toEqual([{ code: 'overlap-too-long', clipId: 'c', max: 2 }]);
    expect(r.placed[2]?.overlapIn).toBe(2);
  });

  it('reports clips without a known length', () => {
    expect(layout([clip('a')], lengths([]), defaultMix()).issues).toEqual([{ code: 'missing-length', clipId: 'a' }]);
  });
});

describe('timesCsv', () => {
  it('lists start times and quotes titles when needed', () => {
    const r = layout([clip('a'), clip('b')], lengths([['a', 65], ['b', 10]]), defaultMix());
    const titles: Record<string, string> = { a: 'Obertura', b: 'Acto 1, "entrada"' };
    expect(timesCsv(r.placed, (id) => titles[id] ?? '')).toBe('n,start,title\n1,0:00.000,Obertura\n2,0:59.000,"Acto 1, ""entrada"""\n');
  });
});

describe('moveItem', () => {
  it('moves without mutating', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
