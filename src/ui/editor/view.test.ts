import { describe, expect, it } from 'vitest';
import { emptyPeaks } from '../../engine/peaks.ts';
import { defaultEdits } from '../../model/edits.ts';
import { defaultSettings } from '../../model/settings.ts';
import { fadeGain, gainAt, normalizeDb, preview } from './preview.ts';
import { clampView, fit, follow, MIN_SPAN, pan, parseClock, peakRange, timeToX, xToTime, zoomAt } from './view.ts';

describe('view', () => {
  it('converts between time and pixels over the stretch shown', () => {
    const v = { s: 10, e: 20 };
    expect(timeToX(15, 200, v)).toBe(100);
    expect(xToTime(50, 200, v)).toBe(12.5);
  });

  it('zooms around a time that stays under the same pixel', () => {
    const v = zoomAt({ s: 0, e: 100 }, 25, 0.5, 100);
    expect(v).toEqual({ s: 12.5, e: 62.5 });
    expect(timeToX(25, 100, v)).toBeCloseTo(25);
  });

  it('never zooms past the file or below the narrowest span', () => {
    expect(zoomAt({ s: 0, e: 100 }, 50, 4, 100)).toEqual({ s: 0, e: 100 });
    expect(zoomAt({ s: 0, e: 1 }, 0.5, 0.001, 100).e - zoomAt({ s: 0, e: 1 }, 0.5, 0.001, 100).s).toBeCloseTo(MIN_SPAN);
    expect(fit(0)).toEqual({ s: 0, e: MIN_SPAN });
  });

  it('pans within the file and follows the playhead', () => {
    expect(pan({ s: 0, e: 10 }, 95, 100)).toEqual({ s: 90, e: 100 });
    expect(clampView(-5, 5, 100)).toEqual({ s: 0, e: 10 });
    expect(follow({ s: 0, e: 10 }, 15, 100)).toEqual({ s: 5, e: 15 });
    expect(follow({ s: 20, e: 30 }, 12, 100)).toEqual({ s: 12, e: 22 });
    expect(follow({ s: 0, e: 10 }, 5, 100)).toEqual({ s: 0, e: 10 });
  });

  it('gathers the peaks of a pixel column and leaves out what is not computed', () => {
    const p = emptyPeaks(2, 10);
    p.min.set([-0.1, -0.4, -0.2]);
    p.max.set([0.2, 0.3, 0.6]);
    p.ready = 1;
    expect(peakRange(p, 0, 0.2)).toEqual([-0.4, 0.3].map(Math.fround));
    expect(peakRange(p, 0.1, 0.3)).toEqual([-0.4, 0.6].map(Math.fround));
    expect(peakRange(p, 1.5, 1.6)).toBeNull();
  });

  it('reads times as people type them', () => {
    expect(parseClock('1:02.5')).toBe(62.5);
    expect(parseClock('0:01:02,250')).toBe(62.25);
    expect(parseClock(' 62 ')).toBe(62);
    expect(parseClock('1.5:00')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});

describe('preview', () => {
  it('follows afade curves', () => {
    expect(fadeGain('tri', 0.25)).toBe(0.25);
    expect(fadeGain('qsin', 1)).toBeCloseTo(1);
    expect(fadeGain('hsin', 0.5)).toBeCloseTo(0.5);
    expect(fadeGain('esin', 0.5)).toBeCloseTo(1 - Math.cos(Math.PI / 4));
    expect(fadeGain('log', 0)).toBe(0);
    expect(fadeGain('exp', 1)).toBe(1);
    expect(fadeGain('tri', 2)).toBe(1);
  });

  it('is silent outside the kept range and fades at its ends', () => {
    const edits = { ...defaultEdits(), in: 2, out: 12, fadeIn: { duration: 2, curve: 'tri' as const }, fadeOut: { duration: 4, curve: 'tri' as const } };
    const p = preview(edits, 20, defaultSettings(), null, null);
    expect(gainAt(p, 1)).toBe(0);
    expect(gainAt(p, 3)).toBeCloseTo(0.5);
    expect(gainAt(p, 6)).toBe(1);
    expect(gainAt(p, 11)).toBeCloseTo(0.25);
    expect(gainAt(p, 12)).toBe(0);
  });

  it('cuts the silences only when trimming them', () => {
    const silences = { head: 1, tail: 18 };
    const on = { ...defaultSettings(), trim: { silence: true, lossless: false } };
    expect(preview(defaultEdits(), 20, on, silences, null).range).toEqual({ start: 1, end: 18 });
    expect(preview(defaultEdits(), 20, defaultSettings(), silences, null).range).toEqual({ start: 0, end: 20 });
  });

  it('applies the gain normalizing will, once measured', () => {
    const s = defaultSettings();
    s.normalize = { ...s.normalize, enabled: true, lufs: -14 };
    const unmeasured = preview(defaultEdits(), 20, s, null, null);
    expect(unmeasured).toMatchObject({ gain: 1, unmeasured: true });
    const m = { kind: 'loudnorm' as const, i: -20, tp: -3, lra: 5, thresh: -30, offset: 0 };
    expect(preview(defaultEdits(), 20, s, null, m).gain).toBeCloseTo(10 ** (6 / 20));
    expect(normalizeDb({ ...s.normalize, mode: 'peak', peak: -1 }, { kind: 'volume', maxVolume: -7 })).toBe(6);
  });

  it('copying the track keeps only the cut', () => {
    const s = defaultSettings();
    s.extract = { ...s.extract, mode: 'copy' };
    s.normalize = { ...s.normalize, enabled: true };
    const edits = { ...defaultEdits(), fadeIn: { duration: 5, curve: 'tri' as const } };
    const p = preview(edits, 20, s, null, null);
    expect(p).toMatchObject({ gain: 1, unmeasured: false });
    expect(gainAt(p, 1)).toBe(1);
  });
});
