// Messages between the engine and the worker that makes a video with WebCodecs.

import type { MixSegment } from '../../model/mix.ts';
import type { Rational } from '../../model/media.ts';
import type { VideoJob } from '../../model/operations.ts';
import type { HapVariant } from '../../model/settings.ts';

export interface RunRequest {
  type: 'run';
  file: File;
  /** The sound as made by ffmpeg (an m4a; a WAV for HAP), or null for a silent video. */
  audio: File | null;
  job: VideoJob;
  bitrate: number;
  /** Name of the output under `compositio-out/` in OPFS. */
  out: string;
}

/** A video mix: the clips as segments on a canvas, and the mix's sound as an m4a made by ffmpeg. */
export interface MixRequest {
  type: 'mix';
  /** The file of each segment, by `MixSegment.file`. */
  files: File[];
  audio: File | null;
  segments: MixSegment[];
  width: number;
  height: number;
  fps: number;
  /** The same rate as a fraction, for a .mov's time scale. */
  rate: Rational;
  /** Set for a HAP mix: the texture. The bitrate is not used then. */
  hap: HapVariant | null;
  /** Seconds of the whole mix. */
  duration: number;
  /** Fades of the whole mix to black, in seconds. */
  fadeIn: number;
  fadeOut: number;
  bitrate: number;
  out: string;
}

export type WorkerRequest = RunRequest | MixRequest;

export type WorkerMessage =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; size: number }
  | { type: 'error'; name: string; message: string };

export const OUTPUT_DIR = 'compositio-out';
