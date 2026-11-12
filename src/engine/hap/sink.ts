// Where the frames of a HAP video go: each is read from the canvas, compressed by the pool, and
// written to the .mov in order, with the sound interleaved by seconds.

import type { Rational } from '../../model/media.ts';
import type { FrameEncoder } from './pool.ts';
import { MovWriter, pcmForMov, wavInfo, type MovSink, type PcmFormat } from './mov.ts';
import type { HapVariant } from './texture.ts';

export interface HapSinkOptions {
  sink: MovSink;
  /** The canvas's 2D context, read once per frame. */
  read: () => ArrayBuffer;
  width: number;
  height: number;
  rate: Rational;
  variant: HapVariant;
  /** The sound as a WAV file, or null. */
  audio: Blob | null;
  encoder: FrameEncoder;
}

export class HapSink {
  private readonly pending: Promise<Uint8Array>[] = [];
  private readonly limit: number;
  private audioSamples = 0;

  private constructor(
    private readonly o: HapSinkOptions,
    private readonly mov: MovWriter,
    private readonly wav: { format: PcmFormat; start: number; length: number } | null,
  ) {
    this.limit = Math.max(2, o.encoder.size * 2);
  }

  static async open(o: HapSinkOptions): Promise<HapSink> {
    const wav = o.audio ? wavInfo(new Uint8Array(await o.audio.slice(0, 65536).arrayBuffer()), o.audio.size) : null;
    const mov = new MovWriter(o.sink, { width: o.width, height: o.height, fps: o.rate, variant: o.variant, audio: wav?.format ?? null });
    return new HapSink(o, mov, wav);
  }

  /** Takes the canvas as it is now as the next frame. */
  async add(): Promise<void> {
    const frame = this.o.encoder.encode(this.o.read(), this.o.width, this.o.height, this.o.variant);
    // A failure is raised where the frame is awaited, in order; until then it is not unhandled.
    frame.catch(() => {});
    this.pending.push(frame);
    while (this.pending.length >= this.limit) await this.writeOne();
  }

  private async writeOne(): Promise<void> {
    const frame = await this.pending.shift()!;
    this.mov.addVideo(frame);
    await this.interleave(this.mov.frames);
  }

  /** The sound up to the end of frame `n`, in chunks of about a second. */
  private async interleave(n: number, all = false): Promise<void> {
    const w = this.wav;
    if (!w || !this.o.audio) return;
    const bytesPer = (w.format.channels * w.format.bits) / 8;
    const total = Math.floor(w.length / bytesPer);
    const upTo = all ? total : Math.min(total, Math.floor((n * this.o.rate.den * w.format.rate) / this.o.rate.num));
    if (!all && upTo - this.audioSamples < w.format.rate) return;
    if (upTo <= this.audioSamples) return;
    const from = w.start + this.audioSamples * bytesPer;
    const bytes = new Uint8Array(await this.o.audio.slice(from, w.start + upTo * bytesPer).arrayBuffer());
    this.mov.addAudio(pcmForMov(bytes, w.format.bits));
    this.audioSamples = upTo;
  }

  /** Writes what is left and the index; returns the size of the file. */
  async finish(): Promise<number> {
    while (this.pending.length > 0) await this.writeOne();
    await this.interleave(this.mov.frames, true);
    return this.mov.finish();
  }

  close(): void {
    this.o.encoder.close();
  }
}
