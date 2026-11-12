// A QuickTime (.mov) writer for what HAP needs: one video track of HAP frames and, optionally, one of
// PCM sound. It streams: the media data goes out as it comes, the index is written at the end, and
// every offset is 64 bits, so a file may pass 4 GB.

import { FOURCC } from './frame.ts';
import type { HapVariant } from './texture.ts';

/** Where the file goes: a position and bytes. OPFS in the worker, memory in tests. */
export interface MovSink {
  write(data: Uint8Array, at: number): void;
}

export type PcmBits = 16 | 24 | 32;

export interface PcmFormat {
  rate: number;
  channels: number;
  /** 32 is floating point. Samples are given little-endian, as WAV has them. */
  bits: PcmBits;
}

export interface MovOptions {
  width: number;
  height: number;
  fps: { num: number; den: number };
  variant: HapVariant;
  audio?: PcmFormat | null;
}

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};
const u16 = (n: number): Uint8Array => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
};
const u64 = (n: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};
const zeros = (n: number): Uint8Array => new Uint8Array(n);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const body = cat(...parts);
  return cat(u32(body.length + 8), enc.encode(type), body);
};
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array =>
  box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const MATRIX = cat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

/** Sample entry tags of PCM in QuickTime: 16 bits little-endian, 24 and 32-bit float big-endian. */
const PCM_TAG: Record<PcmBits, string> = { 16: 'sowt', 24: 'in24', 32: 'fl32' };

/** WAV's little-endian samples as the entry says them: 16 bits stay, the others turn around. */
export function pcmForMov(data: Uint8Array, bits: PcmBits): Uint8Array {
  if (bits === 16) return data;
  const width = bits / 8;
  const out = new Uint8Array(data.length - (data.length % width));
  for (let i = 0; i < out.length; i += width) for (let k = 0; k < width; k++) out[i + k] = data[i + width - 1 - k]!;
  return out;
}

const TIMESCALE_MOVIE = 1000;

export class MovWriter {
  private pos = 0;
  private readonly mdatAt: number;
  private readonly videoSizes: number[] = [];
  private readonly videoOffsets: number[] = [];
  private readonly audioChunks: { offset: number; samples: number }[] = [];
  private audioSamples = 0;
  private finished = false;

  constructor(
    private readonly sink: MovSink,
    private readonly o: MovOptions,
  ) {
    this.put(box('ftyp', enc.encode('qt  '), u32(0), enc.encode('qt  ')));
    // A 64-bit size, corrected when the data ends.
    this.mdatAt = this.pos;
    this.put(cat(u32(1), enc.encode('mdat'), u64(16)));
  }

  private put(data: Uint8Array): void {
    this.sink.write(data, this.pos);
    this.pos += data.length;
  }

  get frames(): number {
    return this.videoSizes.length;
  }

  addVideo(frame: Uint8Array): void {
    this.videoOffsets.push(this.pos);
    this.videoSizes.push(frame.length);
    this.put(frame);
  }

  /** PCM as the entry wants it (see `pcmForMov`), whole sample frames. */
  addAudio(data: Uint8Array): void {
    const a = this.o.audio;
    if (!a || data.length === 0) return;
    const frameBytes = (a.channels * a.bits) / 8;
    const samples = Math.floor(data.length / frameBytes);
    if (samples === 0) return;
    this.audioChunks.push({ offset: this.pos, samples });
    this.audioSamples += samples;
    this.put(samples * frameBytes === data.length ? data : data.subarray(0, samples * frameBytes));
  }

  /** Writes the index and corrects the size of the media data; returns the size of the file. */
  finish(): number {
    if (this.finished) return this.pos;
    this.finished = true;
    this.sink.write(u64(this.pos - this.mdatAt), this.mdatAt + 8);
    this.put(this.moov());
    return this.pos;
  }

  private moov(): Uint8Array {
    const { fps } = this.o;
    const videoDuration = (this.videoSizes.length * fps.den) / fps.num;
    const audioDuration = this.o.audio ? this.audioSamples / this.o.audio.rate : 0;
    const tracks = [this.videoTrack(1, videoDuration)];
    if (this.o.audio && this.audioSamples > 0) tracks.push(this.audioTrack(2, audioDuration));
    const movieDuration = Math.round(Math.max(videoDuration, audioDuration) * TIMESCALE_MOVIE);
    const mvhd = full(
      'mvhd', 0, 0,
      u32(0), u32(0), u32(TIMESCALE_MOVIE), u32(movieDuration), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), MATRIX,
      zeros(24), u32(tracks.length + 1),
    );
    return box('moov', mvhd, ...tracks);
  }

  private tkhd(id: number, seconds: number, audio: boolean): Uint8Array {
    const { width, height } = this.o;
    return full(
      'tkhd', 0, 3,
      u32(0), u32(0), u32(id), u32(0), u32(Math.round(seconds * TIMESCALE_MOVIE)), zeros(8),
      u16(0), u16(0), u16(audio ? 0x100 : 0), u16(0), MATRIX,
      u32(audio ? 0 : width << 16), u32(audio ? 0 : height << 16),
    );
  }

  private videoTrack(id: number, seconds: number): Uint8Array {
    const { width, height, fps, variant } = this.o;
    const n = this.videoSizes.length;
    const fourcc = FOURCC[variant];
    const entry = new Uint8Array(86);
    const dv = new DataView(entry.buffer);
    dv.setUint32(0, 86);
    entry.set(enc.encode(fourcc), 4);
    dv.setUint16(14, 1); // data reference
    dv.setUint32(28, 0x200); // spatial quality
    dv.setUint16(32, width);
    dv.setUint16(34, height);
    dv.setUint32(36, 0x00480000); // 72 dpi
    dv.setUint32(40, 0x00480000);
    dv.setUint16(48, 1); // frames per sample
    entry[50] = 4; // the compressor name, as a Pascal string
    entry.set(enc.encode(fourcc), 51);
    dv.setUint16(82, 24); // depth
    dv.setInt16(84, -1); // no color table
    const stbl = box(
      'stbl',
      full('stsd', 0, 0, u32(1), entry),
      full('stts', 0, 0, u32(1), u32(n), u32(fps.den)),
      full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
      full('stsz', 0, 0, u32(0), u32(n), ...this.videoSizes.map(u32)),
      full('co64', 0, 0, u32(n), ...this.videoOffsets.map(u64)),
    );
    const minf = box('minf', full('vmhd', 0, 1, zeros(8)), dinf(), stbl);
    const mdia = box(
      'mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(fps.num), u32(n * fps.den), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), new Uint8Array([0])),
      minf,
    );
    return box('trak', this.tkhd(id, seconds, false), mdia);
  }

  private audioTrack(id: number, seconds: number): Uint8Array {
    const a = this.o.audio!;
    const entry = cat(
      u32(36), enc.encode(PCM_TAG[a.bits]), zeros(6), u16(1), // data reference
      u16(0), u16(0), u32(0), // version, revision, vendor
      u16(a.channels), u16(a.bits), u16(0), u16(0), u32(a.rate * 0x10000),
    );
    // One entry per run of chunks of the same size.
    const runs: { first: number; samples: number }[] = [];
    this.audioChunks.forEach((c, i) => {
      if (runs.length === 0 || runs[runs.length - 1]!.samples !== c.samples) runs.push({ first: i + 1, samples: c.samples });
    });
    const stbl = box(
      'stbl',
      full('stsd', 0, 0, u32(1), entry),
      full('stts', 0, 0, u32(1), u32(this.audioSamples), u32(1)),
      full('stsc', 0, 0, u32(runs.length), ...runs.flatMap((r) => [u32(r.first), u32(r.samples), u32(1)])),
      full('stsz', 0, 0, u32((a.channels * a.bits) / 8), u32(this.audioSamples)),
      full('co64', 0, 0, u32(this.audioChunks.length), ...this.audioChunks.map((c) => u64(c.offset))),
    );
    const minf = box('minf', full('smhd', 0, 0, zeros(4)), dinf(), stbl);
    const mdia = box(
      'mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(a.rate), u32(this.audioSamples), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), enc.encode('soun'), zeros(12), new Uint8Array([0])),
      minf,
    );
    return box('trak', this.tkhd(id, seconds, true), mdia);
  }
}

const dinf = (): Uint8Array => box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));

/** Where a WAV file's samples are and what they are, from its first bytes; null when the mov cannot take them. */
export function wavInfo(head: Uint8Array, fileSize: number): { format: PcmFormat; start: number; length: number } | null {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (i: number) => String.fromCharCode(head[i]!, head[i + 1]!, head[i + 2]!, head[i + 3]!);
  if (head.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: { code: number; channels: number; rate: number; bits: number } | null = null;
  let i = 12;
  while (i + 8 <= head.length) {
    const size = dv.getUint32(i + 4, true);
    if (tag(i) === 'fmt ' && i + 24 <= head.length) {
      let code = dv.getUint16(i + 8, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its sub-format.
      if (code === 0xfffe && size >= 26 && i + 34 <= head.length) code = dv.getUint16(i + 8 + 24, true);
      fmt = { code, channels: dv.getUint16(i + 10, true), rate: dv.getUint32(i + 12, true), bits: dv.getUint16(i + 22, true) };
    } else if (tag(i) === 'data') {
      if (!fmt) return null;
      const start = i + 8;
      // A streamed WAV may say 0 or too much: the file's end is the end.
      const length = size === 0 || start + size > fileSize ? fileSize - start : size;
      const ok = (fmt.code === 1 && (fmt.bits === 16 || fmt.bits === 24)) || (fmt.code === 3 && fmt.bits === 32);
      if (!ok) return null;
      return { format: { rate: fmt.rate, channels: fmt.channels, bits: fmt.bits as PcmBits }, start, length };
    }
    i += 8 + size + (size % 2);
  }
  return null;
}
