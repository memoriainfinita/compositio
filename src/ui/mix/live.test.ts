import { describe, expect, it } from 'vitest';
import { defaultEdits } from '../../model/edits.ts';
import { media } from '../../model/fixtures.ts';
import type { MixClip } from '../../model/mix.ts';
import { defaultSettings } from '../../model/settings.ts';
import { defaultMix, type Clip, type MixSettings } from '../../model/timeline.ts';
import { clipAt, livePlan, mixGain, soundingAt } from './live.ts';

const clip = (id: string, transitionIn: Clip['transitionIn'] = null): Clip => ({ id, fileId: `f-${id}`, kind: 'audio', transitionIn });

const mc = (id: string, over: Partial<MixClip> = {}): MixClip => ({
  clip: clip(id),
  info: media({ duration: 60 }),
  edits: defaultEdits(),
  settings: defaultSettings(),
  silences: null,
  ...over,
});

const mix = (over: Partial<MixSettings> = {}): MixSettings => ({ ...defaultMix(), ...over });

describe('livePlan', () => {
  it('places the clips as the mix does and reads each from its kept part', () => {
    const a = mc('a', { edits: { ...defaultEdits(), in: 5, out: 50 } });
    const live = livePlan([a, mc('b')], mix(), null);
    expect(live.duration).toBe(45 + 60 - 6);
    expect(live.clips.map((c) => [c.at, c.from, c.length, c.overlapIn, c.overlapOut])).toEqual([
      [0, 5, 45, 0, 6],
      [39, 0, 60, 6, 0],
    ]);
  });

  it('turns the matching gains into linear ones only when matching is on', () => {
    const gains = new Map([['a', -6]]);
    expect(livePlan([mc('a')], mix({ matchLoudness: true }), gains).clips[0]!.gain).toBeCloseTo(0.501, 3);
    expect(livePlan([mc('a')], mix(), gains).clips[0]!.gain).toBe(1);
    expect(livePlan([mc('a')], mix({ matchLoudness: true }), null).clips[0]!.gain).toBe(1);
  });
});

describe('soundingAt', () => {
  it('crossfades with the transition curve on both sides', () => {
    const live = livePlan([mc('a'), mc('b')], mix(), null);
    // The cross runs from 54 to 60 in the mix.
    expect(soundingAt(live, 30)).toEqual([{ index: 0, fileTime: 30, gain: 1 }]);
    const mid = soundingAt(live, 57);
    expect(mid.map((s) => s.index)).toEqual([0, 1]);
    expect(mid[0]!.fileTime).toBe(57);
    expect(mid[1]!.fileTime).toBe(3);
    expect(mid[0]!.gain).toBeCloseTo(0.5, 6);
    expect(mid[1]!.gain).toBeCloseTo(0.5, 6);
    expect(clipAt(live, 57)).toBe(1);
  });

  it('uses the clip own transition curve', () => {
    const b = mc('b');
    b.clip = clip('b', { duration: 4, curve: 'qsin', cut: false });
    const live = livePlan([mc('a'), b], mix(), null);
    const [out, into] = soundingAt(live, 58);
    expect(out!.gain).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(into!.gain).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it('plays a dry cut one clip after the other', () => {
    const b = mc('b');
    b.clip = clip('b', { duration: 6, curve: 'tri', cut: true });
    const live = livePlan([mc('a'), b], mix(), null);
    expect(live.duration).toBe(120);
    expect(soundingAt(live, 59.9)).toEqual([{ index: 0, fileTime: 59.9, gain: 1 }]);
    expect(soundingAt(live, 60)).toEqual([{ index: 1, fileTime: 0, gain: 1 }]);
  });

  it('applies the file fades and the matching gain', () => {
    const a = mc('a', { edits: { ...defaultEdits(), fadeIn: { duration: 10, curve: 'tri' } } });
    const live = livePlan([a], mix({ matchLoudness: true }), new Map([['a', 20 * Math.log10(0.5)]]));
    expect(soundingAt(live, 5)[0]!.gain).toBeCloseTo(0.25, 6);
    expect(soundingAt(live, 20)[0]!.gain).toBeCloseTo(0.5, 6);
  });

  it('applies the mix fades over the whole', () => {
    const live = livePlan([mc('a'), mc('b')], mix({ fadeIn: { duration: 4, curve: 'tri' }, fadeOut: { duration: 10, curve: 'tri' } }), null);
    expect(mixGain(live, 1)).toBeCloseTo(0.25, 6);
    expect(mixGain(live, 50)).toBe(1);
    expect(soundingAt(live, 109)[0]!.gain).toBeCloseTo(0.5, 6);
  });

  it('is silent outside the mix', () => {
    const live = livePlan([mc('a')], mix(), null);
    expect(soundingAt(live, -1)).toEqual([]);
    expect(soundingAt(live, 60)).toEqual([]);
    expect(clipAt(live, 60)).toBe(-1);
  });
});
