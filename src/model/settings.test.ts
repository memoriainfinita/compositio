import { describe, expect, it } from 'vitest';
import { defaultSettings, effectiveSettings, hasOverrides, pruneOverrides } from './settings.ts';
import { clockTime, ffTime } from './media.ts';

describe('settings', () => {
  it('fills every default', () => {
    const s = defaultSettings();
    expect(s.convert).toMatchObject({ format: 'wav', sampleRate: 'source', bitDepth: 24, dither: true });
    expect(s.convert.mp3).toEqual({ mode: 'cbr', bitrate: 320, quality: 0 });
    expect(s.normalize).toMatchObject({ enabled: false, mode: 'lufs', lufs: -14, truePeak: -1.5 });
    expect(s.output.pattern).toBe('{name}');
  });

  it('applies own values over the batch, nested objects included', () => {
    const batch = defaultSettings();
    const s = effectiveSettings(batch, { convert: { format: 'mp3', mp3: { bitrate: 192 } } as never });
    expect(s.convert.format).toBe('mp3');
    expect(s.convert.mp3).toEqual({ mode: 'cbr', bitrate: 192, quality: 0 });
    expect(batch.convert.format).toBe('wav');
  });

  it('keeps only own values that differ from the batch', () => {
    const batch = defaultSettings();
    expect(pruneOverrides(batch, { convert: { format: 'wav', sampleRate: 48000 } })).toEqual({ convert: { sampleRate: 48000 } });
    expect(hasOverrides(batch, { normalize: { enabled: false } })).toBe(false);
    expect(hasOverrides(batch, { normalize: { enabled: true } })).toBe(true);
  });
});

describe('time formats', () => {
  it('writes seconds for ffmpeg without exponents', () => {
    expect(ffTime(0.0000001)).toBe('0.000000');
    expect(ffTime(30 * 86400 + 0.5)).toBe('2592000.500000');
    expect(ffTime(-1)).toBe('0.000000');
    expect(ffTime(12.5)).toBe('12.500000');
  });

  it('writes clock times for people', () => {
    expect(clockTime(65.4321)).toBe('1:05.432');
    expect(clockTime(3725)).toBe('1:02:05.000');
  });
});
