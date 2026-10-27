import { describe, expect, it } from 'vitest';
import { defaultEdits, editIssues, fittedFades, keptRange } from './edits.ts';

const edits = (over = {}) => ({ ...defaultEdits(), ...over });
const fade = (duration: number) => ({ duration, curve: 'tri' as const });

describe('keptRange', () => {
  it('keeps the whole file by default and clamps to its duration', () => {
    expect(keptRange(edits(), 100)).toEqual({ start: 0, end: 100 });
    expect(keptRange(edits({ in: 10, out: 500 }), 100)).toEqual({ start: 10, end: 100 });
  });

  it('cuts the detected silences on top of in and out', () => {
    expect(keptRange(edits({ in: 1 }), 100, { head: 2.5, tail: 97 })).toEqual({ start: 2.5, end: 97 });
    expect(keptRange(edits({ in: 5, out: 90 }), 100, { head: 2.5, tail: 97 })).toEqual({ start: 5, end: 90 });
  });

  it('is empty when out is before in', () => {
    expect(keptRange(edits({ in: 50, out: 20 }), 100)).toEqual({ start: 50, end: 50 });
  });
});

describe('editIssues', () => {
  it('reports what cannot be processed', () => {
    expect(editIssues(edits(), 100)).toEqual([]);
    expect(editIssues(edits({ in: 50, out: 20 }), 100)).toEqual(['out-before-in', 'empty-range']);
    expect(editIssues(edits({ in: 0, out: 10, fadeIn: fade(6), fadeOut: fade(6) }), 100)).toEqual(['fades-too-long']);
  });

  it('shortens fades in proportion when they do not fit', () => {
    const f = fittedFades(edits({ fadeIn: fade(6), fadeOut: fade(2) }), 4);
    expect(f.fadeIn.duration).toBe(3);
    expect(f.fadeOut.duration).toBe(1);
  });
});
