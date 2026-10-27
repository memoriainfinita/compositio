// The waveform of a file, in parts: ffmpeg decodes each part to mono at a low rate and every few
// samples become one minimum and one maximum. Nothing decodes the whole file at once.

import { ffTime, type MediaInfo } from '../model/media.ts';
import { failure, inputPath, outputPath, type RunOptions, type Runner } from './runner.ts';

/** Decoding rate: enough for the envelope a waveform shows, far less than playback needs. */
export const PEAK_SOURCE_RATE = 16000;
/** Stored peaks per second: one per 5 ms, finer than any cut people make by eye. */
export const PEAK_RATE = 200;
/** Seconds decoded per part: 10 min of mono float at 16 kHz is about 38 MB. */
export const PEAK_PART = 600;

export interface Peaks {
  /** Peaks per second. */
  rate: number;
  min: Float32Array;
  max: Float32Array;
  /** Seconds from the start already filled in; the rest draws as not yet known. */
  ready: number;
}

export const emptyPeaks = (duration: number, rate = PEAK_RATE): Peaks => {
  const n = Math.max(1, Math.ceil(duration * rate));
  return { rate, min: new Float32Array(n), max: new Float32Array(n), ready: 0 };
};

/** Folds samples into minimum and maximum pairs of `per` samples each, written from `offset`. */
export function reduceInto(peaks: Peaks, samples: Float32Array, per: number, offset: number): void {
  const count = Math.ceil(samples.length / per);
  for (let p = 0; p < count && offset + p < peaks.min.length; p++) {
    const a = p * per;
    const b = Math.min(a + per, samples.length);
    let lo = 1;
    let hi = -1;
    for (let i = a; i < b; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks.min[offset + p] = Math.max(-1, lo);
    peaks.max[offset + p] = Math.min(1, hi);
  }
}

/** Start and length of each part to decode. */
export function parts(duration: number, size = PEAK_PART): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  for (let start = 0; start < duration; start += size) out.push({ start, length: Math.min(size, duration - start) });
  return out;
}

/**
 * Computes the peaks of one audio track part by part. `onPart` runs after each part with the same
 * `Peaks`, so the waveform can draw what is known so far.
 */
export async function computePeaks(
  runner: Runner,
  file: File,
  info: MediaInfo,
  track: number,
  onPart: (peaks: Peaks) => void,
  { signal, onProgress }: RunOptions = {},
): Promise<Peaks> {
  const peaks = emptyPeaks(info.duration);
  const per = PEAK_SOURCE_RATE / PEAK_RATE;
  const all = parts(info.duration);
  const out = 'peaks.f32';
  for (const [i, part] of all.entries()) {
    const args = [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-ss', ffTime(part.start), '-t', ffTime(part.length),
      '-i', inputPath(0, file),
      '-map', `0:a:${track}`, '-ac', '1', '-ar', String(PEAK_SOURCE_RATE), '-c:a', 'pcm_f32le', '-f', 'f32le',
      outputPath(out),
    ];
    const r = await runner.run({ inputs: [file], args, outputs: [out] }, { signal });
    const blob = r.files.get(out);
    if (r.code !== 0 || !blob) throw failure(r.log);
    reduceInto(peaks, new Float32Array(await blob.arrayBuffer()), per, Math.round(part.start * PEAK_RATE));
    peaks.ready = part.start + part.length;
    onPart(peaks);
    onProgress?.((i + 1) / all.length);
  }
  return peaks;
}
