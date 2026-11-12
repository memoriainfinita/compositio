// The .mov of HAP against the ffmpeg installed on the machine, which reads Hap1 and HapY: it must
// recognize the files, find the frames and the sound, and decode a picture as close to the original
// as ffmpeg's own HAP encoder gets. Skipped when there is no ffmpeg.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hapFrame } from './frame.ts';
import { MovWriter, type MovSink } from './mov.ts';
import { compressTexture, type HapVariant } from './texture.ts';
import { psnr, testPicture } from './testing.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = hasFfmpeg ? mkdtempSync(join(tmpdir(), 'compositio-hap-')) : '';
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const W = 160;
const H = 96;
const N = 12;

class Memory implements MovSink {
  bytes = new Uint8Array(0);
  write(data: Uint8Array, at: number): void {
    if (at + data.length > this.bytes.length) {
      const b = new Uint8Array(Math.max(at + data.length, this.bytes.length * 2));
      b.set(this.bytes);
      this.bytes = b;
    }
    this.bytes.set(data, at);
  }
}

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { stdio: 'pipe', maxBuffer: 1 << 28 });

/** All frames of a file as RGBA, decoded by ffmpeg. */
const decode = (file: string): Uint8Array[] => {
  const raw = ff(['-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const size = W * H * 4;
  return Array.from({ length: raw.length / size }, (_, i) => new Uint8Array(raw.subarray(i * size, (i + 1) * size)));
};

const probe = (file: string) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_name,codec_type,nb_read_frames,width,height,sample_rate,channels', '-of', 'json', file]).toString()) as {
    format: { duration: string };
    streams: { codec_name: string; codec_type: string; nb_read_frames?: string; width?: number; height?: number; sample_rate?: string; channels?: number }[];
  };

function ours(variant: HapVariant, frames: Uint8Array[], withSound: boolean): string {
  const mem = new Memory();
  const mov = new MovWriter(mem, { width: W, height: H, fps: { num: 24, den: 1 }, variant, audio: withSound ? { rate: 48000, channels: 2, bits: 16 } : null });
  const second = 48000 * 4;
  // Sound as a sine, interleaved every 6 frames (a quarter of a second).
  let t = 0;
  for (const [i, f] of frames.entries()) {
    mov.addVideo(hapFrame(compressTexture(f, W, H, variant), variant));
    if (withSound && i % 6 === 5) {
      const chunk = new Uint8Array(second / 4);
      const dv = new DataView(chunk.buffer);
      for (let k = 0; k < chunk.length / 4; k++, t++) {
        const s = Math.round(8000 * Math.sin((2 * Math.PI * 440 * t) / 48000));
        dv.setInt16(k * 4, s, true);
        dv.setInt16(k * 4 + 2, s, true);
      }
      mov.addAudio(chunk);
    }
  }
  const size = mov.finish();
  const file = join(dir, `${variant}-${withSound ? 'sound' : 'silent'}.mov`);
  writeFileSync(file, mem.bytes.subarray(0, size));
  return file;
}

describe.skipIf(!hasFfmpeg)('HAP against native ffmpeg', () => {
  const frames = Array.from({ length: N }, (_, i) => testPicture(W, H, i * 5));

  for (const variant of ['hap', 'hapq'] as const) {
    it(`${variant}: ffmpeg finds a hap video with every frame, and the sound`, () => {
      const info = probe(ours(variant, frames, true));
      const v = info.streams.find((s) => s.codec_type === 'video')!;
      const a = info.streams.find((s) => s.codec_type === 'audio')!;
      expect(v.codec_name).toBe('hap');
      expect(v.nb_read_frames).toBe(String(N));
      expect([v.width, v.height]).toEqual([W, H]);
      expect(a.codec_name).toBe('pcm_s16le');
      expect([a.sample_rate, a.channels]).toEqual(['48000', 2]);
      expect(Number(info.format.duration)).toBeCloseTo(N / 24, 1);
    });

    it(`${variant}: decodes close to the original, as close as ffmpeg's own encoder`, () => {
      const decoded = decode(ours(variant, frames, false));
      expect(decoded).toHaveLength(N);
      const mine = decoded.map((d, i) => psnr(frames[i]!, d));
      expect(Math.min(...mine)).toBeGreaterThan(28);

      // The same pictures through ffmpeg's encoder, when this ffmpeg has it.
      const enc = spawnSync('ffmpeg', ['-hide_banner', '-encoders']).stdout.toString();
      if (!/\bhap\b/.test(enc)) return;
      const src = join(dir, 'src.rgba');
      writeFileSync(src, Buffer.concat(frames.map((f) => Buffer.from(f))));
      const theirs = join(dir, `ref-${variant}.mov`);
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', '24', '-i', src, '-c:v', 'hap', '-format', variant === 'hap' ? 'hap' : 'hap_q', theirs]);
      const ref = decode(theirs).map((d, i) => psnr(frames[i]!, d));
      const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      expect(avg(mine)).toBeGreaterThan(avg(ref) - 1.5);
    });
  }

  it('reads the sound back in step with the picture', () => {
    const file = ours('hap', frames, true);
    const raw = ff(['-i', file, '-map', '0:a:0', '-f', 's16le', '-']);
    expect(raw.length / 4 / 48000).toBeCloseTo(N / 24, 2);
  });
});
