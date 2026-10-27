// The engine as the app sees it: ffmpeg.wasm behind a queue, with the screen kept on while it works.
// Audio uses the single-thread core: multithreading gave no gain for audio (spec, «Pruebas de
// riesgo») and the multithread core would add 32 MB to the first use.

import type { Silences } from '../model/edits.ts';
import type { MediaInfo } from '../model/media.ts';
import { detectSilences, probeFile, processFile, type Processed } from './jobs.ts';
import type { PlanInput } from '../model/operations.ts';
import { createQueue, type Queue } from './queue.ts';
import type { Runner } from './runner.ts';
import { coreUrls, WasmRunner } from './wasm-runner.ts';
import { createWakeLock, type WakeLock, type WakeState } from './wakelock.ts';

declare const __FFMPEG_CORE__: string;

export interface Engine {
  queue: Queue;
  wakeLock: WakeLock;
  /** Whether this browser could run the multithread core (for video, and for the warning). */
  multithread: boolean;
  /** Loads the engine ahead of the first job. */
  warmUp(): Promise<void>;
  probe(file: File): Promise<MediaInfo>;
  silences(file: File, info: MediaInfo, track?: number): Promise<Silences>;
  process(label: string, file: File, input: Omit<PlanInput, 'inputPath' | 'outputPath'>): { id: string; result: Promise<Processed> };
  dispose(): void;
}

export function createEngine(
  runner: Runner = new WasmRunner(coreUrls(__FFMPEG_CORE__)),
  onWakeChange?: (state: WakeState) => void,
): Engine {
  const wakeLock = createWakeLock(undefined, onWakeChange);
  const queue = createQueue((busy) => wakeLock.setActive(busy));
  return {
    queue,
    wakeLock,
    multithread: self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function',
    warmUp: async () => runner.load?.(),
    probe: (file) => queue.add(file.name, (o) => probeFile(runner, file, o), 'background').result,
    silences: (file, info, track) => queue.add(file.name, (o) => detectSilences(runner, file, info, track, o), 'background').result,
    process: (label, file, input) => queue.add(label, (o) => processFile(runner, file, input, o)),
    dispose() {
      wakeLock.dispose();
      runner.dispose();
    },
  };
}

export { EngineError, type EngineErrorCode } from './runner.ts';
export type { Processed } from './jobs.ts';
export type { JobView } from './queue.ts';
