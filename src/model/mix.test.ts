import { describe, expect, it } from 'vitest';
import { defaultEdits } from './edits.ts';
import { clip as clipInfo, media, track } from './fixtures.ts';
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
    b.clip = clip('b', { duration: 3, curve: 'qsin', cut: false, style: 'dissolve' as const });
    const c = mc('c');
    c.clip = clip('c', { duration: 3, curve: 'tri', cut: true, style: 'dissolve' as const });
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
    const p = previewPlan([mc('a'), mc('b')], { duration: 6, curve: 'tri', cut: false, style: 'dissolve' as const }, mix(), null, ['/in/0/a', '/in/1/b'], 'o');
    if ('error' in p) throw new Error(p.error);
    expect(p.args.slice(3, 14)).toEqual(['-ss', '44.000000', '-t', '16.000000', '-i', '/in/0/a', '-ss', '0.000000', '-t', '16.000000', '-i']);
    expect(filterOf(p.args)).toContain('[a0][a1]acrossfade=d=6.000000');
    expect(p).toMatchObject({ crossAt: 10, duration: 26 });
  });

  it('keeps what is left of a fade the window starts in', () => {
    const a = mc('a', { info: media({ duration: 20 }), edits: { ...defaultEdits(), fadeOut: { duration: 20, curve: 'tri' } } });
    const p = previewPlan([a, mc('b')], { duration: 6, curve: 'tri', cut: false, style: 'dissolve' as const }, mix(), null, ['x', 'y'], 'o');
    if ('error' in p) throw new Error(p.error);
    // The window is the last 16 s of a 20 s fade out: the fade starts before it.
    expect(filterOf(p.args)).toContain('[0:a:0]afade=t=out:st=0.000000:d=16.000000:curve=tri');
  });

  it('plays a dry cut with context on both sides', () => {
    const p = previewPlan([mc('a'), mc('b')], { duration: 6, curve: 'tri', cut: true, style: 'dissolve' as const }, mix(), null, ['x', 'y'], 'o');
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
    expect(measureArgs({ ...s, track: s.track! }, 'p')).toEqual(expect.arrayContaining(['-ss', '1.000000', '-t', '10.000000', '-map', '0:a:0']));
  });
});

describe('wavBytes', () => {
  it('counts 24-bit stereo frames', () => {
    expect(wavBytes(60, 48000)).toBe(60 * 48000 * 6 + 44);
  });
});

describe('video mix plan', () => {
  const vclip = (id: string, over: Partial<MixClip> = {}): MixClip => ({ ...mc(id, { info: clipInfo({ duration: 10 }, { width: 160, height: 90 }) }), ...over });
  const vmix = (over: Partial<MixSettings> = {}): MixSettings => mix({ kind: 'video', transition: { duration: 2, curve: 'tri', cut: false, style: 'dissolve' }, ...over });
  const planOf = (clips: MixClip[], settings: MixSettings) => {
    const p = mixPlan(clips, settings, paths(clips.length), '/out/m');
    if ('error' in p) throw new Error(p.error);
    return p;
  };

  it('draws every clip on the first clip canvas and joins them with xfade at the layout time', () => {
    const p = planOf([vclip('a'), vclip('b'), vclip('c')], vmix());
    const args = p.render(null) as string[];
    const f = filterOf(args);
    expect(f).toContain('[0:v:0]scale=w=160:h=90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25/1,setpts=PTS-STARTPTS,format=yuv420p[v0]');
    expect(f).toContain('[v0][v1]xfade=transition=fade:duration=2.000000:offset=8.000000[w1]');
    expect(f).toContain('[w1][v2]xfade=transition=fade:duration=2.000000:offset=16.000000[w2]');
    expect(f).toContain('[w2]null[vout]');
    expect(args).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[out]', '-c:v', 'libx264', '-c:a', 'aac']));
    expect(p.extension).toBe('mp4');
    expect(p.video?.canvas).toEqual({ size: { width: 160, height: 90 }, fps: { num: 25, den: 1 } });
  });

  it('puts silence where a clip has no sound and black where it has no picture', () => {
    const mute = vclip('b', { info: clipInfo({ duration: 10 }, { width: 160, height: 90 }) });
    mute.info = { ...mute.info, tracks: mute.info.tracks.filter((t) => t.kind === 'video') };
    const sound = mc('s');
    const f = filterOf(planOf([vclip('a'), mute, sound], vmix()).render(null) as string[]);
    expect(f).toContain('anullsrc=r=44100:cl=stereo:d=10.000000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1]');
    expect(f).toContain('color=c=black:s=160x90:r=25/1:d=60.000000,setsar=1,format=yuv420p[v2]');
  });

  it('keeps the dry cut as concat and takes the mix fades to black', () => {
    const cut = vclip('b');
    cut.clip = clip('b', { duration: 0, curve: 'tri', cut: true, style: 'dissolve' as const });
    const f = filterOf(planOf([vclip('a'), cut], vmix({ fadeIn: { duration: 1, curve: 'tri' }, fadeOut: { duration: 3, curve: 'tri' } })).render(null) as string[]);
    expect(f).toContain('[v0][v1]concat=n=2:v=1:a=0[w1]');
    expect(f).toContain('[w1]fade=t=in:st=0:d=1.000000,fade=t=out:st=17.000000:d=3.000000[vout]');
  });

  it('uses a fixed canvas, the chosen fit and rate, and ProRes', () => {
    const settings = vmix({ video: { ...defaultMix().video, canvas: 'fixed', width: 1280, height: 720, fit: 'fill', fps: '30', format: 'prores', proresProfile: 'hq' } });
    const p = planOf([vclip('a'), vclip('b')], settings);
    const args = p.render(null) as string[];
    expect(filterOf(args)).toContain('scale=w=1280:h=720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30/1');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'prores_ks', '-profile:v', '3', '-f', 'mov']));
    expect(p.extension).toBe('mov');
  });

  it('plans a HAP mix: a mov, a canvas of multiples of 4, the sound as WAV, and no ffmpeg render', () => {
    const settings = vmix({ video: { ...defaultMix().video, canvas: 'fixed', width: 1282, height: 722, format: 'hap', hapVariant: 'hap' } });
    const p = planOf([vclip('a'), vclip('b')], settings);
    expect(p.extension).toBe('mov');
    expect(p.video!.canvas.size).toEqual({ width: 1280, height: 720 });
    expect(p.render(null)).toEqual({ error: 'hap-needs-decoder' });
    expect(p.renderAudio(null)).toEqual(expect.arrayContaining(['-c:a', 'pcm_s24le', '-f', 'wav']));
  });

  it('warns of what a video mix ignores or approximates', () => {
    const fast = vclip('a');
    fast.settings = { ...defaultSettings(), picture: { ...defaultSettings().picture, speed: 2 } };
    expect(planOf([fast, vclip('b')], vmix()).warnings).toEqual(['mix-ignores-speed']);
    const curved = vclip('b');
    curved.clip = clip('b', { duration: 2, curve: 'qsin', cut: false, style: 'dissolve' as const });
    expect(planOf([vclip('a'), curved], vmix()).warnings).toEqual(['video-curve-linear']);
    expect(planOf([vclip('a'), vclip('b')], vmix()).warnings).toEqual([]);
  });

  it('refuses a video mix without any picture, and keeps refusing silent clips in an audio mix', () => {
    expect(mixPlan([mc('a'), mc('b')], vmix(), paths(2), 'o')).toEqual({ error: 'no-picture' });
    const mute = vclip('a');
    mute.info = { ...mute.info, tracks: mute.info.tracks.filter((t) => t.kind === 'video') };
    expect(mixPlan([mute], mix(), paths(1), 'o')).toEqual({ error: 'no-audio-track' });
  });
});
