// Which engine makes a video job, and how long it will take. Pure: the capabilities are measured
// elsewhere and passed in.

import type { VideoJob } from '../../model/operations.ts';
import type { HapVariant } from '../../model/settings.ts';
import { outputFps } from '../../model/video.ts';

/** The setting: leave it to the app, or force one engine (to diagnose). */
export type VideoEngine = 'auto' | 'ffmpeg' | 'webcodecs';
export const VIDEO_ENGINES: readonly VideoEngine[] = ['auto', 'ffmpeg', 'webcodecs'];

/** `hap` is the own HAP encoder: it draws like WebCodecs and compresses in workers. */
export type Backend = 'ffmpeg' | 'webcodecs' | 'hap';

export const engineLabel = (b: Backend | null): string => (b === 'webcodecs' ? 'WebCodecs' : b === 'hap' ? 'HAP' : b === 'ffmpeg' ? 'ffmpeg.wasm' : '—');

export interface Capabilities {
  /** The browser has the WebCodecs API at all. */
  api: boolean;
  /** The H.264 encoder accepts this job's size, rate and bitrate. */
  encode: boolean;
  /** The input's video decodes. */
  decode: boolean;
}

export const NO_CAPABILITIES: Capabilities = { api: false, encode: false, decode: false };

export type Choice = { backend: Backend } | { backend: null; reason: BackendReason };
export type BackendReason = 'forced-webcodecs-unavailable' | 'hap-needs-decoder';

export function chooseBackend(job: Pick<VideoJob, 'portable' | 'codec'>, caps: Capabilities, setting: VideoEngine): Choice {
  // HAP has no ffmpeg way, whatever the setting says: it needs the browser to decode the input.
  if (job.codec === 'hap') return caps.api && caps.decode ? { backend: 'hap' } : { backend: null, reason: 'hap-needs-decoder' };
  if (!job.portable) return { backend: 'ffmpeg' };
  if (setting === 'ffmpeg') return { backend: 'ffmpeg' };
  const ok = caps.api && caps.encode && caps.decode;
  if (ok) return { backend: 'webcodecs' };
  if (setting === 'webcodecs') return { backend: null, reason: 'forced-webcodecs-unavailable' };
  return { backend: 'ffmpeg' };
}

/**
 * Times the duration the job takes, from what was measured (spec, «Pruebas de riesgo de vídeo»):
 * ffmpeg.wasm goes at 0.4 to 0.7 of real time at 1080p everywhere, and WebCodecs about three times
 * faster than that. Rounded to the prudent side, scaled by pixels per second.
 */
export function estimateRatio(job: VideoJob, backend: Backend, workers?: number): number {
  if (backend === 'hap') return hapRatio(job.picture.size, outputFps(job.picture), job.hapVariant, workers);
  return ratioFor(job.picture.size, outputFps(job.picture) * job.speed, backend);
}

/**
 * The same for a video mix, which draws its canvas at its rate. Measured on a phone (three 1080p clips,
 * 2 s crossfades): WebCodecs 1.07 times the duration, ffmpeg.wasm more than 18 (it did not finish in 480 s),
 * because `xfade` decodes and filters several inputs at once. Hence its own, much higher, bases.
 */
export const estimateMixRatio = (size: { width: number; height: number }, fps: number, backend: Backend, hap?: HapVariant, workers?: number): number =>
  backend === 'hap' ? hapRatio(size, fps, hap ?? 'hap', workers) : ratioFor(size, fps, backend, { ffmpeg: 20, webcodecs: 1.2 });

/**
 * HAP: the texture of every frame is compressed in a pool of workers, so the time is the frame's cost
 * over the workers, at the rate. Seconds of one core per 1080p frame, measured on a desktop with
 * flat to very busy pictures: Hap 0.035 to 0.28, Hap Q 0.055 to 0.34. Rounded up toward the busy end.
 */
const HAP_FRAME_SECONDS: Record<HapVariant, number> = { hap: 0.2, hapq: 0.3 };
function hapRatio(size: { width: number; height: number }, fps: number, variant: HapVariant, workers = 4): number {
  const perFrame = HAP_FRAME_SECONDS[variant] * ((size.width * size.height) / (1920 * 1080));
  return (perFrame * fps) / Math.max(1, workers);
}

function ratioFor(size: { width: number; height: number }, fps: number, backend: Backend, bases: { ffmpeg: number; webcodecs: number } = { ffmpeg: 2.5, webcodecs: 2.5 / 3 }): number {
  const pixelsPerSecond = size.width * size.height * fps;
  const reference = 1920 * 1080 * 30; // seconds of work per second of video are given at this size and rate
  return (backend === 'ffmpeg' ? bases.ffmpeg : bases.webcodecs) * (pixelsPerSecond / reference);
}

/** From this many times the duration, the job gets a warning. */
export const SLOW_RATIO = 2;
