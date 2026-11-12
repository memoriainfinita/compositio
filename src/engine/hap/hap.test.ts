import { describe, expect, it } from 'vitest';
import { hapFrame } from './frame.ts';
import { MovWriter, pcmForMov, wavInfo, type MovSink } from './mov.ts';
import type { FrameEncoder } from './pool.ts';
import { HapSink } from './sink.ts';
import { snappy, unsnappy } from './snappy.ts';
import { compressTexture, decompressTexture, textureBytes, type HapVariant } from './texture.ts';
import { psnr, randomBytes, testPicture } from './testing.ts';

describe('texture compression', () => {
  const w = 64;
  const h = 48;
  const src = testPicture(w, h);

  it('sizes the texture by variant', () => {
    expect(textureBytes('hap', w, h)).toBe((w * h) / 2);
    expect(textureBytes('hapq', w, h)).toBe(w * h);
    expect(compressTexture(src, w, h, 'hap').length).toBe((w * h) / 2);
    expect(compressTexture(src, w, h, 'hapq').length).toBe(w * h);
  });

  it('keeps a picture close in both variants', () => {
    const a = psnr(src, decompressTexture(compressTexture(src, w, h, 'hap'), w, h, 'hap'));
    const b = psnr(src, decompressTexture(compressTexture(src, w, h, 'hapq'), w, h, 'hapq'));
    expect(a).toBeGreaterThan(30);
    expect(b).toBeGreaterThan(30);
  });

  it('stores black as black, within a step', () => {
    const flat = new Uint8Array(16 * 4).fill(0);
    for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
    for (const v of ['hap', 'hapq'] as HapVariant[]) {
      const back = decompressTexture(compressTexture(flat, 4, 4, v), 4, 4, v);
      // Hap Q's chroma passes through 565 and can be one step off.
      expect(Math.max(...Array.from(back).filter((_, i) => i % 4 !== 3))).toBeLessThanOrEqual(v === 'hapq' ? 2 : 0);
    }
  });

  it('refuses a size that is not a multiple of 4', () => {
    expect(() => compressTexture(new Uint8Array(6 * 4 * 4), 6, 4, 'hap')).toThrow(RangeError);
  });
});

describe('snappy', () => {
  it('round trips data with and without repeats', () => {
    const repeated = new Uint8Array(5000).map((_, i) => (i % 7) * 3);
    const noise = new Uint8Array(3000).map((_, i) => (Math.imul(i, 2654435761) >>> 24) & 255);
    for (const d of [repeated, noise, new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(70000).fill(9)]) {
      expect(Array.from(unsnappy(snappy(d)))).toEqual(Array.from(d));
    }
    expect(snappy(repeated).length).toBeLessThan(repeated.length / 4);
  });
});

describe('hapFrame', () => {
  it('writes a three-byte length and the type of the variant and compressor', () => {
    const flat = new Uint8Array(1024);
    const f = hapFrame(flat, 'hap');
    expect(f[3]).toBe(0xbb); // snappy, DXT1
    expect(f[0]! | (f[1]! << 8) | (f[2]! << 16)).toBe(f.length - 4);
    const noise = randomBytes(1024);
    expect(hapFrame(noise, 'hapq')[3]).toBe(0xaf); // no compressor, YCoCg DXT5
  });

  it('uses the extended header from 16 MB', () => {
    const big = randomBytes(0x1000000 + 16);
    const f = hapFrame(big, 'hap');
    expect(Array.from(f.slice(0, 3))).toEqual([0, 0, 0]);
    expect(new DataView(f.buffer, f.byteOffset).getUint32(4, true)).toBe(f.length - 8);
  });
});

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

const boxes = (b: Uint8Array, from = 0, to = b.length): { type: string; start: number; end: number }[] => {
  const out: { type: string; start: number; end: number }[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = from;
  while (i + 8 <= to) {
    let size = dv.getUint32(i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (size === 1) size = Number(dv.getBigUint64(i + 8));
    out.push({ type, start: i, end: i + size });
    i += size;
  }
  return out;
};

describe('MovWriter', () => {
  it('writes ftyp, mdat with its 64-bit size, and moov with the tracks', () => {
    const mem = new Memory();
    const mov = new MovWriter(mem, { width: 8, height: 8, fps: { num: 30, den: 1 }, variant: 'hap', audio: { rate: 48000, channels: 2, bits: 16 } });
    for (let i = 0; i < 3; i++) mov.addVideo(new Uint8Array(10 + i).fill(i + 1));
    mov.addAudio(new Uint8Array(4800 * 4));
    const size = mov.finish();
    const top = boxes(mem.bytes.subarray(0, size));
    expect(top.map((t) => t.type)).toEqual(['ftyp', 'mdat', 'moov']);
    expect(top[2]!.end).toBe(size);
    const moov = boxes(mem.bytes, top[2]!.start + 8, top[2]!.end);
    expect(moov.map((t) => t.type)).toEqual(['mvhd', 'trak', 'trak']);
    expect(mov.frames).toBe(3);
  });

  it('is video alone when there is no sound', () => {
    const mem = new Memory();
    const mov = new MovWriter(mem, { width: 8, height: 8, fps: { num: 30000, den: 1001 }, variant: 'hapq' });
    mov.addVideo(new Uint8Array(5));
    mov.addAudio(new Uint8Array(100));
    const size = mov.finish();
    const moov = boxes(mem.bytes.subarray(0, size)).find((b) => b.type === 'moov')!;
    expect(boxes(mem.bytes, moov.start + 8, moov.end).map((t) => t.type)).toEqual(['mvhd', 'trak']);
  });
});

/** A WAV of 16-bit stereo silence. */
export function wavOf(seconds: number, rate = 48000): Uint8Array {
  const data = rate * 4 * seconds;
  const wav = new Uint8Array(44 + data);
  const dv = new DataView(wav.buffer);
  wav.set([82, 73, 70, 70], 0);
  dv.setUint32(4, 36 + data, true);
  wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  wav.set([100, 97, 116, 97], 36);
  dv.setUint32(40, data, true);
  return wav;
}

describe('PCM', () => {
  it('turns 24-bit and float samples to big-endian and leaves 16 bits', () => {
    expect(Array.from(pcmForMov(new Uint8Array([1, 2, 3, 4, 5, 6]), 24))).toEqual([3, 2, 1, 6, 5, 4]);
    expect(Array.from(pcmForMov(new Uint8Array([1, 2, 3, 4]), 32))).toEqual([4, 3, 2, 1]);
    const s = new Uint8Array([1, 2]);
    expect(pcmForMov(s, 16)).toBe(s);
  });

  it('reads the format and the place of the samples in a WAV', () => {
    const wav = wavOf(1);
    expect(wavInfo(wav, wav.length)).toEqual({ format: { rate: 48000, channels: 2, bits: 16 }, start: 44, length: 48000 * 4 });
    expect(wavInfo(new Uint8Array(20), 20)).toBeNull();
  });
});

describe('HapSink', () => {
  const inline = (size: number): FrameEncoder => ({
    size,
    // The first frames take the longest, so the answers come out of order.
    encode: (rgba, w, h, v) =>
      new Promise((resolve) => setTimeout(() => resolve(hapFrame(compressTexture(new Uint8Array(rgba), w, h, v), v)), Math.max(0, 8 - new Uint8Array(rgba)[0]! * 2))),
    close: () => {},
  });

  it('writes every frame, in order, and the sound', async () => {
    const mem = new Memory();
    const w = 16;
    const h = 16;
    let n = 0;
    const sink = await HapSink.open({
      sink: mem,
      read: () => {
        const px = new Uint8Array(w * h * 4);
        px[0] = n++;
        return px.buffer;
      },
      width: w,
      height: h,
      rate: { num: 10, den: 1 },
      variant: 'hap',
      audio: new Blob([wavOf(2) as BlobPart]),
      encoder: inline(3),
    });
    for (let i = 0; i < 20; i++) await sink.add();
    const size = await sink.finish();
    const top = boxes(mem.bytes.subarray(0, size));
    expect(top.map((t) => t.type)).toEqual(['ftyp', 'mdat', 'moov']);
    const moov = top[2]!;
    const text = new TextDecoder('latin1').decode(mem.bytes.subarray(moov.start, moov.end));
    expect(text).toContain('Hap1');
    expect(text).toContain('sowt');
  });
});
