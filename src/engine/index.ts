// The engine as the app sees it: ffmpeg.wasm behind a queue, with the screen kept on while it works.
// Audio uses the single-thread core: multithreading gave no gain for audio (spec, «Pruebas de
// riesgo») and the multithread core would add 32 MB to the first use. Video through ffmpeg.wasm
// uses the multithread core, which needs cross-origin isolation, with its threads named explicitly.

import type { Silences } from '../model/edits.ts';
import type { MediaInfo } from '../model/media.ts';
import { assessFile, assessMix, detectSilences, listenCopy, measureFile, measureMix, mixFiles, previewTransition, probeFile, processFile, extractFrame, type Assessment, type FileJob, type FrameJob, type ListenFormat, type MixInput, type Processed } from './jobs.ts';
import type { Measurement } from '../model/operations.ts';
import type { Transition } from '../model/timeline.ts';
import { computePeaks, type Peaks } from './peaks.ts';
import { createQueue, type Priority, type Queue } from './queue.ts';
import type { Runner } from './runner.ts';
import { coreUrls, WasmRunner } from './wasm-runner.ts';
import type { VideoEngine } from './webcodecs/backend.ts';
import { createWakeLock, type WakeLock, type WakeState } from './wakelock.ts';

declare const __FFMPEG_CORE__: string;
declare const __FFMPEG_CORE_MT__: string;
declare const __FFMPEG_WASM_BYTES__: number;

export interface Engine {
  queue: Queue;
  wakeLock: WakeLock;
  /** Whether this browser could run the multithread core (for video, and for the warning). */
  multithread: boolean;
  /** Loads the engine ahead of the first job; `onBytes` follows the core's download. */
  warmUp(onBytes?: (loaded: number, total: number) => void): Promise<void>;
  probe(file: File): Promise<MediaInfo>;
  silences(file: File, info: MediaInfo, track?: number): Promise<Silences>;
  /** A file's waveform, part by part; `onPart` sees each part as it lands. The active file's is `view`. */
  peaks(file: File, info: MediaInfo, track: number, onPart: (peaks: Peaks) => void, priority?: Priority): { id: string; result: Promise<Peaks> };
  /** The first pass of normalizing, so the editor's B can sound at the level the result will. */
  measure(file: File, input: FileJob): Promise<Measurement | null>;
  /** A copy the browser can play, for files it cannot. */
  /** A frame of a video as an image; the caller cancels by id like any other job. */
  frame(file: File, job: FrameJob): Promise<Blob>;
  listen(file: File, info: MediaInfo, track: number, format: ListenFormat): Promise<Blob>;
  /** Which engine would make a video and how slow it would be, before processing; null for sound files. */
  assess(file: File, input: FileJob): Promise<Assessment | null>;
  process(label: string, file: File, input: FileJob): { id: string; result: Promise<Processed> };
  mix(label: string, input: MixInput): { id: string; result: Promise<Processed> };
  /** Which engine would make a video mix and how slow it would be; null for a sound mix. */
  assessMix(input: MixInput): Promise<Assessment | null>;
  /** Matching's gains by clip id, in dB, for listening to the mix; measurements land in `input.measured`. */
  measureMix(input: MixInput): Promise<Map<string, number>>;
  /** One transition with some context; the caller cancels it by id when a newer one is asked for. */
  preview(input: MixInput & { transition: Transition }): { id: string; result: Promise<{ blob: Blob; crossAt: number }> };
  dispose(): void;
}

export function createEngine(
  runner: Runner = new WasmRunner(coreUrls(__FFMPEG_CORE__, document.baseURI, __FFMPEG_WASM_BYTES__), coreUrls(__FFMPEG_CORE_MT__)),
  onWakeChange?: (state: WakeState) => void,
  /** The app's setting «Motor de vídeo», read at each job. */
  videoEngine: () => VideoEngine = () => 'auto',
): Engine {
  const multithread = self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
  /** The x264 encoder gets two threads on the multithread core: automatic ones abort its worker. */
  const withThreads = (input: FileJob): FileJob => {
    const job = { ...input, videoEngine: videoEngine() };
    return multithread && input.settings.extract.kind === 'video' ? { ...job, encoderThreads: 2 } : job;
  };
  const mixJob = (input: MixInput): MixInput => ({ ...input, videoEngine: videoEngine(), ...(multithread && input.mix.kind === 'video' ? { encoderThreads: 2 } : {}) });
  const wakeLock = createWakeLock(undefined, onWakeChange);
  const queue = createQueue((busy) => wakeLock.setActive(busy));
  return {
    queue,
    wakeLock,
    multithread,
    warmUp: async (onBytes) => runner.load?.(onBytes),
    probe: (file) => queue.add(file.name, (o) => probeFile(runner, file, o), 'background').result,
    silences: (file, info, track) => queue.add(file.name, (o) => detectSilences(runner, file, info, track, o), 'background').result,
    peaks: (file, info, track, onPart, priority = 'view') => queue.add(file.name, (o) => computePeaks(runner, file, info, track, onPart, o), priority),
    measure: (file, input) => queue.add(file.name, (o) => measureFile(runner, file, withThreads(input), o), 'view').result,
    frame: (file, job) => queue.add(file.name, (o) => extractFrame(runner, file, job, o), 'view').result,
    listen: (file, info, track, format) => queue.add(file.name, (o) => listenCopy(runner, file, info, track, format, o), 'view').result,
    assess: (file, input) => assessFile(file, withThreads(input)),
    process: (label, file, input) => queue.add(label, (o) => processFile(runner, file, withThreads(input), o)),
    mix: (label, input) => queue.add(label, (o) => mixFiles(runner, mixJob(input), o)),
    assessMix: (input) => assessMix(mixJob(input)),
    measureMix: (input) => queue.add('', (o) => measureMix(runner, input, o), 'view').result,
    preview: (input) => queue.add(input.files[1]?.name ?? '', (o) => previewTransition(runner, input, o), 'view'),
    dispose() {
      wakeLock.dispose();
      runner.dispose();
    },
  };
}

export { EngineError, type EngineErrorCode } from './runner.ts';
export type { ListenFormat, MixInput, Processed } from './jobs.ts';
export type { Peaks } from './peaks.ts';
export type { JobView } from './queue.ts';
export { sweepOutputs } from './webcodecs/opfs.ts';
export { engineLabel, VIDEO_ENGINES, type Backend, type VideoEngine } from './webcodecs/backend.ts';
export { browserVideoSupport } from './webcodecs/capabilities.ts';
