import { describe, expect, it } from 'vitest';
import { defaultEdits } from './edits.ts';
import { media, track } from './fixtures.ts';
import { matchGain, measureArgs, mixPlan, previewPlan, sourceOf, wavBytes, type MixClip } from './mix.ts';
import { defaultSettings } from './settings.ts';
import { defaultMix, type Clip, type MixSettings } from './timeline.ts';

const clip = (id: string, transitionIn: Clip['transitionIn'] = null): Clip => ({ id, fileId: `f-${id}`, kind: 'audio', transitionIn });

const mc = (id: string, over: Partial<MixClip> = {}): MixClip => ({
  clip: clip(id),
  info: media({ duration: 60 }),
  edits: defaultEdits(),
  settings: defaultSettings(),
  silences: null,
  ...over,
});

const paths = (n: number) => Array.from({ length: n }, (_, i) => `/in/${i}/x.wav`);
const mix = (over: Partial<MixSettings> = {}): MixSettings => ({ ...defaultMix(), ...over });

const filterOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]!;

describe('mixPlan', () => {
  it('cuts each input to its kept part and chains crossfades', () => {
    const a = mc('a', { edits: { ...defaultEdits(), in: 5, out: 50 } });
    const p = mixPlan([a, mc('b'), mc('c')], mix(), paths(3), '/out/mix');
    if ('error' in p) throw new Error(p.error);
    const args = p.render(null);
    if (!Array.isArray(args)) throw new Error(args.error);
    expect(args.slice(3, 9)).toEqual(['-ss', '5.000000', '-t', '45.000000', '-i', '/in/0/x.wav']);
    expect(filterOf(args)).toBe(
      '[0:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];' +
        '[1:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];' +
        '[2:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a2];' +
        '[a0][a1]acrossfade=d=6.000000:c1=tri:c2=tri[m1];[m1][a2]acrossfade=d=6.000000:c1=tri:c2=tri[m2];[m2]anull[out]',
    );
    expect(args.slice(-6)).toEqual(['[out]', '-c:a', 'pcm_s24le', '-f', 'wav', '/out/mix']);
    expect(p.layout.duration).toBe(45 + 60 + 60 - 12);
  });

  it('joins a dry cut with concat and uses the clip curve', () => {
    const b = mc('b');
    b.clip = clip('b', { duration: 3, curve: 'qsin', cut: false });
    const c = mc('c');
    c.clip = clip('c', { duration: 3, curve: 'tri', cut: true });
    const p = mixPlan([mc('a'), b, c], mix(), paths(3), 'o');
    if ('error' in p) throw new Error(p.error);
    const f = filterOf(p.render(null) as string[]);
    expect(f).toContain('[a0][a1]acrossfade=d=3.000000:c1=qsin:c2=qsin[m1]');
    expect(f).toContain('[m1][a2]concat=n=2:v=0:a=1[m2]');
  });

  it('keeps the file fades, the mix fades and the chosen rate', () => {
    const a = mc('a', { edits: { ...defaultEdits(), fadeIn: { duration: 2, curve: 'tri' }, fadeOut: { duration: 4, curve: 'exp' } } });
    const p = mixPlan([a, mc('b')], mix({ sampleRate: 48000, fadeIn: { duration: 1, curve: 'tri' }, fadeOut: { duration: 8, curve: 'log' } }), paths(2), 'o');
    if ('error' in p) throw new Error(p.error);
    const f = filterOf(p.render(null) as string[]);
    expect(f).toContain('[0:a:0]afade=t=in:st=0:d=2.000000:curve=tri,afade=t=out:st=56.000000:d=4.000000:curve=exp,aresample=48000');
    expect(f).toContain('[m1]afade=t=in:st=0:d=1.000000:curve=tri,afade=t=out:st=106.000000:d=8.000000:curve=log[out]');
  });

  it('reads the track and the silences the file settings choose', () => {
    const settings = defaultSettings();
    settings.extract.track = 1;
    settings.trim.silence = true;
    const info = media({ duration: 60, tracks: [track(), track({ index: 1 })] });
    const s = sourceOf(mc('a', { info, settings, silences: { head: 2, tail: 55 } }));
    expect(s).toMatchObject({ start: 2, length: 53, track: { index: 1 } });
  });

  it('needs gains when matching loudness and applies them', () => {
    const p = mixPlan([mc('a'), mc('b')], mix({ matchLoudness: true }), paths(2), 'o');
    if ('error' in p) throw new Error(p.error);
    expect(p.render(null)).toEqual({ error: 'missing-measurement' });
    const f = filterOf(p.render(new Map([['a', -3.5], ['b', 0]])) as string[]);
    expect(f).toContain('[0:a:0]volume=-3.50dB,aresample');
    expect(f).toContain('[1:a:0]aresample');
  });

  it('writes MP3 at 320 kbps', () => {
    const p = mixPlan([mc('a')], mix({ format: 'mp3' }), paths(1), 'o');
    if ('error' in p) throw new Error(p.error);
    expect(p.extension).toBe('mp3');
    expect((p.render(null) as string[]).slice(-6)).toEqual(['-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', 'o'].slice(-6));
  });

  it('refuses an empty mix and a clip without sound', () => {
    expect(mixPlan([], mix(), [], 'o')).toEqual({ error: 'no-clips' });
    expect(mixPlan([mc('a', { info: media({ tracks: [] }) })], mix(), paths(1), 'o')).toEqual({ error: 'no-audio-track' });
  });
});

describe('previewPlan', () => {
  it('takes 10 s on each side of the cross', () => {
    const p = previewPlan([mc('a'), mc('b')], { duration: 6, curve: 'tri', cut: false }, mix(), null, ['/in/0/a', '/in/1/b'], 'o');
    if ('error' in p) throw new Error(p.error);
    expect(p.args.slice(3, 14)).toEqual(['-ss', '44.000000', '-t', '16.000000', '-i', '/in/0/a', '-ss', '0.000000', '-t', '16.000000', '-i']);
    expect(filterOf(p.args)).toContain('[a0][a1]acrossfade=d=6.000000');
    expect(p).toMatchObject({ crossAt: 10, duration: 26 });
  });

  it('keeps what is left of a fade the window starts in', () => {
    const a = mc('a', { info: media({ duration: 20 }), edits: { ...defaultEdits(), fadeOut: { duration: 20, curve: 'tri' } } });
    const p = previewPlan([a, mc('b')], { duration: 6, curve: 'tri', cut: false }, mix(), null, ['x', 'y'], 'o');
    if ('error' in p) throw new Error(p.error);
    // The window is the last 16 s of a 20 s fade out: the fade starts before it.
    expect(filterOf(p.args)).toContain('[0:a:0]afade=t=out:st=0.000000:d=16.000000:curve=tri');
  });

  it('plays a dry cut with context on both sides', () => {
    const p = previewPlan([mc('a'), mc('b')], { duration: 6, curve: 'tri', cut: true }, mix(), null, ['x', 'y'], 'o');
    if ('error' in p) throw new Error(p.error);
    expect(filterOf(p.args)).toContain('concat=n=2');
    expect(p).toMatchObject({ crossAt: 10, duration: 20 });
  });
});

describe('matchGain', () => {
  const m = (i: number, tp: number) => ({ kind: 'loudnorm' as const, i, tp, lra: 5, thresh: -30, offset: 0 });

  it('brings the loudness to the target', () => {
    expect(matchGain(m(-20, -8), -14)).toBe(6);
    expect(matchGain(m(-9, -0.5), -14)).toBe(-5);
  });

  it('holds back a gain that would push the peak over the ceiling', () => {
    expect(matchGain(m(-20, -3), -14)).toBe(2);
  });

  it('leaves silence alone', () => {
    expect(matchGain(m(-Infinity, -Infinity), -14)).toBe(0);
  });
});

describe('measureArgs', () => {
  it('measures only the kept part', () => {
    const s = sourceOf(mc('a', { edits: { ...defaultEdits(), in: 1, out: 11 } }));
    if ('error' in s) throw new Error(s.error);
    expect(measureArgs(s, 'p')).toEqual(expect.arrayContaining(['-ss', '1.000000', '-t', '10.000000', '-map', '0:a:0']));
  });
});

describe('wavBytes', () => {
  it('counts 24-bit stereo frames', () => {
    expect(wavBytes(60, 48000)).toBe(60 * 48000 * 6 + 44);
  });
});
