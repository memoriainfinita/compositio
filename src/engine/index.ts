// The engine as the app sees it: ffmpeg.wasm behind a queue, with the screen kept on while it works.
// Audio uses the single-thread core: multithreading gave no gain for audio (spec, «Pruebas de
// riesgo») and the multithread core would add 32 MB to the first use.

import type { Silences } from '../model/edits.ts';
import type { MediaInfo } from '../model/media.ts';
import { detectSilences, listenCopy, measureFile, measureMix, mixFiles, previewTransition, probeFile, processFile, type ListenFormat, type MixInput, type Processed } from './jobs.ts';
import type { Measurement, PlanInput } from '../model/operations.ts';
import type { Transition } from '../model/timeline.ts';
import { computePeaks, type Peaks } from './peaks.ts';
import { createQueue, type Queue } from './queue.ts';
import type { Runner } from './runner.ts';
import { coreUrls, WasmRunner } from './wasm-runner.ts';
import { createWakeLock, type WakeLock, type WakeState } from './wakelock.ts';

declare const __FFMPEG_CORE__: string;
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
  /** The active file's waveform, part by part; `onPart` sees each part as it lands. */
  peaks(file: File, info: MediaInfo, track: number, onPart: (peaks: Peaks) => void): { id: string; result: Promise<Peaks> };
  /** The first pass of normalizing, so the editor's B can sound at the level the result will. */
  measure(file: File, input: Omit<PlanInput, 'inputPath' | 'outputPath'>): Promise<Measurement | null>;
  /** A copy the browser can play, for files it cannot. */
  listen(file: File, info: MediaInfo, track: number, format: ListenFormat): Promise<Blob>;
  process(label: string, file: File, input: Omit<PlanInput, 'inputPath' | 'outputPath'>): { id: string; result: Promise<Processed> };
  mix(label: string, input: MixInput): { id: string; result: Promise<Processed> };
  /** Matching's gains by clip id, in dB, for listening to the mix; measurements land in `input.measured`. */
  measureMix(input: MixInput): Promise<Map<string, number>>;
  /** One transition with some context; the caller cancels it by id when a newer one is asked for. */
  preview(input: MixInput & { transition: Transition }): { id: string; result: Promise<{ blob: Blob; crossAt: number }> };
  dispose(): void;
}

export function createEngine(
  runner: Runner = new WasmRunner(coreUrls(__FFMPEG_CORE__, document.baseURI, __FFMPEG_WASM_BYTES__)),
  onWakeChange?: (state: WakeState) => void,
): Engine {
  const wakeLock = createWakeLock(undefined, onWakeChange);
  const queue = createQueue((busy) => wakeLock.setActive(busy));
  return {
    queue,
    wakeLock,
    multithread: self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function',
    warmUp: async (onBytes) => runner.load?.(onBytes),
    probe: (file) => queue.add(file.name, (o) => probeFile(runner, file, o), 'background').result,
    silences: (file, info, track) => queue.add(file.name, (o) => detectSilences(runner, file, info, track, o), 'background').result,
    peaks: (file, info, track, onPart) => queue.add(file.name, (o) => computePeaks(runner, file, info, track, onPart, o), 'view'),
    measure: (file, input) => queue.add(file.name, (o) => measureFile(runner, file, input, o), 'view').result,
    listen: (file, info, track, format) => queue.add(file.name, (o) => listenCopy(runner, file, info, track, format, o), 'view').result,
    process: (label, file, input) => queue.add(label, (o) => processFile(runner, file, input, o)),
    mix: (label, input) => queue.add(label, (o) => mixFiles(runner, input, o)),
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
