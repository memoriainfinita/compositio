import { describe, expect, it } from 'vitest';
import { defaultEdits } from '../../model/edits.ts';
import { clip, media } from '../../model/fixtures.ts';
import { plan, type VideoJob } from '../../model/operations.ts';
import { defaultSettings, effectiveSettings, type Overrides } from '../../model/settings.ts';
import { chooseBackend, estimateMixRatio, estimateRatio, SLOW_RATIO, type Capabilities } from './backend.ts';
import { h264Bitrate } from './bitrate.ts';
import { fadeAlpha, outputFrameCount, resample, sourceTime, type FramePlan } from './resample.ts';

const jobOf = (own: Overrides = {}, info = clip()): VideoJob => {
  const p = plan({
    info,
    edits: defaultEdits(),
    settings: effectiveSettings(defaultSettings(), { extract: { kind: 'video' }, ...own }),
    inputPath: '/in',
    outputPath: '/out',
  });
  if ('error' in p || !p.video) throw new Error('no video job');
  return p.video;
};

const all: Capabilities = { api: true, encode: true, decode: true };

describe('chooseBackend', () => {
  it('uses WebCodecs for H.264 when the browser encodes and decodes it', () => {
    expect(chooseBackend(jobOf(), all, 'auto')).toEqual({ backend: 'webcodecs' });
  });

  it('falls to ffmpeg for what WebCodecs cannot express or the browser cannot do', () => {
    expect(chooseBackend(jobOf({ convert: { videoFormat: 'prores' } }), all, 'auto')).toEqual({ backend: 'ffmpeg' });
    expect(chooseBackend(jobOf(), { ...all, encode: false }, 'auto')).toEqual({ backend: 'ffmpeg' });
    expect(chooseBackend(jobOf(), { ...all, decode: false }, 'auto')).toEqual({ backend: 'ffmpeg' });
    expect(chooseBackend(jobOf(), { api: false, encode: false, decode: false }, 'auto')).toEqual({ backend: 'ffmpeg' });
  });

  it('sends HAP to its own engine whatever the setting, when the browser decodes', () => {
    const hap = jobOf({ convert: { videoFormat: 'hap' } });
    expect(chooseBackend(hap, { ...all, encode: false }, 'auto')).toEqual({ backend: 'hap' });
    expect(chooseBackend(hap, all, 'ffmpeg')).toEqual({ backend: 'hap' });
    expect(chooseBackend(hap, { ...all, decode: false }, 'auto')).toEqual({ backend: null, reason: 'hap-needs-decoder' });
    expect(chooseBackend(hap, { api: false, encode: false, decode: false }, 'webcodecs')).toEqual({ backend: null, reason: 'hap-needs-decoder' });
  });

  it('obeys a forced engine, and refuses instead of falling back when WebCodecs is forced', () => {
    expect(chooseBackend(jobOf(), all, 'ffmpeg')).toEqual({ backend: 'ffmpeg' });
    expect(chooseBackend(jobOf(), { ...all, encode: false }, 'webcodecs')).toEqual({ backend: null, reason: 'forced-webcodecs-unavailable' });
  });
});

describe('estimateRatio', () => {
  it('warns for 1080p on ffmpeg and not on WebCodecs, and scales with pixels and speed', () => {
    const hd = jobOf({}, clip({}, { width: 1920, height: 1080, fps: { num: 30, den: 1 } }));
    expect(estimateRatio(hd, 'ffmpeg')).toBeGreaterThanOrEqual(SLOW_RATIO);
    expect(estimateRatio(hd, 'webcodecs')).toBeLessThan(SLOW_RATIO);
    const small = jobOf({}, clip({}, { width: 640, height: 360, fps: { num: 30, den: 1 } }));
    expect(estimateRatio(small, 'ffmpeg')).toBeLessThan(SLOW_RATIO);
    expect(estimateRatio(jobOf({ picture: { speed: 2 } }, clip({}, { fps: { num: 30, den: 1 } })), 'ffmpeg')).toBeCloseTo(2 * estimateRatio(jobOf({}, clip({}, { fps: { num: 30, den: 1 } })), 'ffmpeg'), 5);
  });

  it('rates HAP by its frames over the workers', () => {
    const hd = { width: 1920, height: 1080 };
    expect(estimateMixRatio(hd, 30, 'hap', 'hap', 1)).toBeCloseTo(6, 5);
    expect(estimateMixRatio(hd, 30, 'hap', 'hap', 3)).toBeCloseTo(2, 5);
    expect(estimateMixRatio(hd, 30, 'hap', 'hapq', 3)).toBeCloseTo(3, 5);
    const job = jobOf({ convert: { videoFormat: 'hap' } }, clip({}, { width: 1920, height: 1080, fps: { num: 30, den: 1 } }));
    expect(estimateRatio(job, 'hap', 3)).toBeCloseTo(2, 5);
  });

  it('rates a video mix far slower on ffmpeg than a single file, from the phone measurement', () => {
    const hd = { width: 1920, height: 1080 };
    expect(estimateMixRatio(hd, 30, 'ffmpeg')).toBeGreaterThanOrEqual(18);
    expect(estimateMixRatio(hd, 30, 'webcodecs')).toBeGreaterThanOrEqual(1.07);
    expect(estimateMixRatio(hd, 30, 'webcodecs')).toBeLessThan(SLOW_RATIO);
  });
});

describe('h264Bitrate', () => {
  it('halves every six CRF steps and scales with the pixels per second', () => {
    expect(h264Bitrate(1920, 1080, 30, 24)).toBeCloseTo(h264Bitrate(1920, 1080, 30, 18) / 2, -3);
    expect(h264Bitrate(1280, 720, 30, 18)).toBeCloseTo(h264Bitrate(1920, 1080, 30, 18) / 2.25, -3);
    expect(h264Bitrate(16, 16, 1, 51)).toBe(100_000);
  });
});

describe('frame grid', () => {
  const p: FramePlan = { start: 1, length: 2, speed: 1, fps: 10 };

  async function* frames(times: number[]) {
    for (const t of times) yield { timestamp: t };
  }
  const collect = async (times: number[], plan: FramePlan) => {
    const dropped: number[] = [];
    const out: { index: number; t: number; within: number }[] = [];
    for await (const r of resample(frames(times), plan, (f) => dropped.push(f.timestamp))) out.push({ index: r.index, t: r.frame.timestamp, within: r.within });
    return { out, dropped };
  };

  it('counts output frames from the length over the speed', () => {
    expect(outputFrameCount(p)).toBe(20);
    expect(outputFrameCount({ ...p, speed: 2 })).toBe(10);
    expect(outputFrameCount({ ...p, speed: 0.5 })).toBe(40);
    expect(sourceTime({ ...p, speed: 2 }, 5)).toBeCloseTo(2, 9);
  });

  it('takes the latest input frame at or before each moment, repeating when the input is slower', async () => {
    // Input at 5 fps over the range, output at 10: every frame twice.
    const { out } = await collect([1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8], { ...p, length: 2 });
    expect(out.slice(0, 4).map((x) => x.t)).toEqual([1, 1, 1.2, 1.2]);
    expect(out).toHaveLength(20);
    expect(out.at(-1)?.t).toBe(2.8);
  });

  it('skips input frames when the output is slower, and reports the ones it dropped', async () => {
    const times = Array.from({ length: 20 }, (_, i) => 1 + i * 0.1);
    const { out, dropped } = await collect(times, { start: 1, length: 2, speed: 1, fps: 5 });
    expect(out.map((x) => Number(x.t.toFixed(1))).slice(0, 4)).toEqual([1, 1.2, 1.4, 1.6]);
    expect(dropped).toContain(1.1);
  });

  it('runs the input clock faster with speed', async () => {
    const times = Array.from({ length: 20 }, (_, i) => 1 + i * 0.1);
    const { out } = await collect(times, { start: 1, length: 2, speed: 2, fps: 10 });
    expect(out).toHaveLength(10);
    expect(out[1]?.t).toBeCloseTo(1.2, 9);
  });
});

describe('fadeAlpha', () => {
  it('rises over the fade in and falls over the fade out, and is 1 in between', () => {
    expect(fadeAlpha(0, 10, 2, 2)).toBe(0);
    expect(fadeAlpha(1, 10, 2, 2)).toBe(0.5);
    expect(fadeAlpha(5, 10, 2, 2)).toBe(1);
    expect(fadeAlpha(9, 10, 2, 2)).toBe(0.5);
    expect(fadeAlpha(10, 10, 2, 2)).toBe(0);
    expect(fadeAlpha(0, 10, 0, 0)).toBe(1);
  });
});

describe('the sound for the WebCodecs engine', () => {
  const input = (own: Overrides) => ({
    info: clip(),
    edits: defaultEdits(),
    settings: effectiveSettings(defaultSettings(), { extract: { kind: 'video' }, ...own }),
    inputPath: '/in/0/a',
    outputPath: '/out/result',
  });
  const audioArgs = (own: Overrides = {}): string => {
    const p = plan(input(own));
    if ('error' in p) throw new Error(p.error);
    const a = p.renderAudio();
    if (!Array.isArray(a)) throw new Error('no audio args');
    return a.join(' ');
  };

  it('is only the sound, as AAC in an m4a, with the speed and the sound filters of the plan', () => {
    expect(audioArgs({ picture: { speed: 2 } })).toBe(
      '-hide_banner -nostdin -y -i /in/0/a -map 0:a:0 -af atempo=2 -c:a aac -b:a 256k -map_metadata 0 -f ipod /out/result',
    );
  });

  it('does not exist without sound, or when the job is not for WebCodecs', () => {
    const none = plan(input({ extract: { kind: 'video', audio: 'none' } }));
    const prores = plan(input({ convert: { videoFormat: 'prores' } }));
    if ('error' in none || 'error' in prores) throw new Error('plan');
    expect(none.renderAudio()).toBeNull();
    expect(prores.renderAudio()).toBeNull();
  });

  it('asks for the measurement when normalizing', () => {
    const p = plan(input({ normalize: { enabled: true } }));
    if ('error' in p) throw new Error(p.error);
    expect(p.renderAudio()).toEqual({ error: 'missing-measurement' });
    expect(p.measure).not.toBeNull();
  });

  it('keeps sound files out of it', () => {
    const p = plan({ ...input({}), info: media(), settings: effectiveSettings(defaultSettings(), {}) });
    if ('error' in p) throw new Error(p.error);
    expect(p.video).toBeNull();
    expect(p.renderAudio()).toBeNull();
  });
});
