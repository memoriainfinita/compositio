// The commands of a video mix against the ffmpeg installed on the machine, not ffmpeg.wasm: they
// must run and give the duration, size and rate the plan promises. Skipped when there is no ffmpeg.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEdits } from './edits.ts';
import { clip as clipInfo, media, track } from './fixtures.ts';
import { mixPlan, type MixClip } from './mix.ts';
import { defaultSettings } from './settings.ts';
import { defaultMix, type Clip, type MixSettings } from './timeline.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = hasFfmpeg ? mkdtempSync(join(tmpdir(), 'compositio-mix-')) : '';
const p = (name: string) => join(dir, name);

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { stdio: 'pipe' });

interface Probe {
  duration: number;
  video: { width: number; height: number; fps: number } | null;
  audio: boolean;
}

function probe(file: string): Probe {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file]).toString();
  const j = JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number) as [number, number];
  return {
    duration: Number(j.format.duration),
    video: v ? { width: v.width!, height: v.height!, fps: n / d } : null,
    audio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

const clip = (id: string, transitionIn: Clip['transitionIn'] = null): Clip => ({ id, fileId: `f-${id}`, kind: 'video', transitionIn });
const mc = (id: string, info: MixClip['info'], over: Partial<MixClip> = {}): MixClip => ({ clip: clip(id), info, edits: defaultEdits(), settings: defaultSettings(), silences: null, ...over });
const mix = (over: Partial<MixSettings> = {}): MixSettings => ({ ...defaultMix(), kind: 'video', transition: { duration: 1, curve: 'tri', cut: false, style: 'dissolve' }, ...over });

// a: 160x90 at 25 fps with sound, 5 s. b: 320x180 at 30 fps without sound, 5 s. s: sound only, 4 s.
const A = clipInfo({ duration: 5 }, { width: 160, height: 90, fps: { num: 25, den: 1 } });
const B = media({ container: 'mov,mp4,m4a,3gp,3g2,mj2', duration: 5, tracks: [clipInfo({}, { width: 320, height: 180, fps: { num: 30, den: 1 } }).tracks[0]!] });
const S = media({ duration: 4, tracks: [track()] });

function run(clips: MixClip[], settings: MixSettings, files: string[], out: string) {
  const plan = mixPlan(clips, settings, files, out);
  if ('error' in plan) throw new Error(plan.error);
  const args = plan.render(null);
  if (!Array.isArray(args)) throw new Error(args.error);
  ff(args);
  return { plan, result: probe(out) };
}

describe.skipIf(!hasFfmpeg)('video mix against native ffmpeg', () => {
  beforeAll(() => {
    ff(['-f', 'lavfi', '-i', 'testsrc=s=160x90:r=25:d=5', '-f', 'lavfi', '-i', 'sine=f=440:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('a.mp4')]);
    ff(['-f', 'lavfi', '-i', 'smptebars=s=320x180:r=30:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('b.mp4')]);
    ff(['-f', 'lavfi', '-i', 'sine=f=220:d=4', p('s.wav')]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('crosses two clips on the first clip canvas and rate', () => {
    const { plan, result } = run([mc('a', A), mc('b', B)], mix(), [p('a.mp4'), p('b.mp4')], p('two.mp4'));
    expect(plan.layout.duration).toBe(9);
    expect(result.video).toEqual({ width: 160, height: 90, fps: 25 });
    expect(result.audio).toBe(true);
    expect(result.duration).toBeCloseTo(9, 0);
  });

  it('chains three clips with a silent one and a black one', () => {
    const { plan, result } = run([mc('a', A), mc('b', B), mc('s', S)], mix(), [p('a.mp4'), p('b.mp4'), p('s.wav')], p('three.mp4'));
    expect(plan.layout.duration).toBe(5 + 5 + 4 - 2);
    expect(plan.video?.parts.map((x) => x.picture === null)).toEqual([false, false, true]);
    expect(result.video).toMatchObject({ width: 160, height: 90 });
    expect(result.duration).toBeCloseTo(12, 0);
  });

  it('joins a dry cut with concat', () => {
    const cut = { duration: 0, curve: 'tri' as const, cut: true, style: 'dissolve' as const };
    const { result } = run([mc('a', A), mc('b', B, { clip: clip('b', cut) })], mix(), [p('a.mp4'), p('b.mp4')], p('cut.mp4'));
    expect(result.duration).toBeCloseTo(10, 0);
    expect(result.video).toMatchObject({ width: 160, height: 90 });
  });

  it('uses a fixed canvas and rate, and the part of the file kept', () => {
    const settings = mix({ video: { ...defaultMix().video, canvas: 'fixed', width: 128, height: 72, fit: 'fill', fps: '30' } });
    const a = mc('a', A, { edits: { ...defaultEdits(), in: 1, out: 4 } });
    const { result } = run([a, mc('b', B)], settings, [p('a.mp4'), p('b.mp4')], p('fixed.mp4'));
    expect(result.video).toEqual({ width: 128, height: 72, fps: 30 });
    expect(result.duration).toBeCloseTo(3 + 5 - 1, 0);
  });

  it('writes ProRes with PCM in mov', () => {
    const settings = mix({ video: { ...defaultMix().video, format: 'prores', proresProfile: 'proxy' } });
    const { plan, result } = run([mc('a', A), mc('b', B)], settings, [p('a.mp4'), p('b.mp4')], p('pro.mov'));
    expect(plan.extension).toBe('mov');
    expect(result.video).toMatchObject({ width: 160, height: 90 });
    expect(result.audio).toBe(true);
  });

  it('takes the mix fades to black and keeps a mix of sound clips alone working', () => {
    const faded = run([mc('a', A), mc('b', B)], mix({ fadeIn: { duration: 1, curve: 'tri' }, fadeOut: { duration: 2, curve: 'tri' } }), [p('a.mp4'), p('b.mp4')], p('fade.mp4'));
    expect(faded.result.duration).toBeCloseTo(9, 0);
    const audioOnly = run([mc('s', S), mc('s2', S)], { ...defaultMix(), transition: { duration: 1, curve: 'tri', cut: false, style: 'dissolve' } }, [p('s.wav'), p('s.wav')], p('sound.wav'));
    expect(audioOnly.result.video).toBeNull();
  });
});
