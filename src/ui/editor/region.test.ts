import { describe, expect, it } from 'vitest';
import { defaultEdits, type FileEdits } from '../../model/edits.ts';
import { MIN_LENGTH, moveRegion, setFadeIn, setFadeOut, setIn, setOut } from './region.ts';

const edits = (over: Partial<FileEdits> = {}): FileEdits => ({ ...defaultEdits(), ...over });
const fade = (duration: number) => ({ duration, curve: 'tri' as const });

describe('region', () => {
  it('keeps in before out', () => {
    expect(setIn(edits({ out: 10 }), 20, 15)).toEqual({ in: 10 - MIN_LENGTH });
    expect(setIn(edits(), 20, -3)).toEqual({ in: 0 });
    expect(setOut(edits({ in: 5 }), 20, 2)).toEqual({ out: 5 + MIN_LENGTH });
  });

  it('stores an out at the end as «up to the end»', () => {
    expect(setOut(edits(), 20, 25)).toEqual({ out: null });
    expect(setOut(edits(), 20, 12)).toEqual({ out: 12 });
  });

  it('shortens the fades when the region gets shorter', () => {
    const e = edits({ fadeIn: fade(4), fadeOut: fade(4) });
    expect(setIn(e, 20, 14)).toEqual({ in: 14, fadeOut: fade(2) });
    expect(setOut(e, 20, 3)).toEqual({ out: 3, fadeIn: fade(3), fadeOut: fade(0) });
  });

  it('moves the region with its length, inside the file', () => {
    expect(moveRegion(edits({ in: 2, out: 6 }), 20, 10)).toEqual({ in: 10, out: 14 });
    expect(moveRegion(edits({ in: 2, out: 6 }), 20, 18)).toEqual({ in: 16, out: null });
    expect(moveRegion(edits({ in: 2, out: 6 }), 20, -1)).toEqual({ in: 0, out: 4 });
  });

  it('fits each fade in what the other leaves', () => {
    const e = edits({ in: 0, out: 10, fadeOut: fade(3) });
    expect(setFadeIn(e, 20, 9)).toEqual({ fadeIn: fade(7) });
    expect(setFadeIn(e, 20, -1)).toEqual({ fadeIn: fade(0) });
    expect(setFadeOut(edits({ out: 10, fadeIn: fade(8) }), 20, 5)).toEqual({ fadeOut: fade(2) });
  });
});
