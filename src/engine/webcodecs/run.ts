// The main-thread side of the WebCodecs engine: starts the worker, follows its progress, and hands
// back the output as a File that reads from OPFS.

import type { VideoJob } from '../../model/operations.ts';
import { classify, EngineError, type RunOptions } from '../runner.ts';
import { newOutputName, readOutput, removeOutput } from './opfs.ts';
import type { MixRequest, RunRequest, WorkerMessage, WorkerRequest } from './protocol.ts';

export interface WebCodecsOutput {
  file: File;
  /** Frees the file in OPFS. */
  release(): Promise<void>;
}

const QUOTA = /quota|no space|storage/i;

export async function runWebCodecs(
  file: File,
  audio: File | null,
  job: VideoJob,
  bitrate: number,
  options: RunOptions = {},
): Promise<WebCodecsOutput> {
  return drive((out): RunRequest => ({ type: 'run', file, audio, job, bitrate, out }), options);
}

/** What the worker needs to make a video mix; the name of the output is added here. */
export type MixJob = Omit<MixRequest, 'type' | 'out'>;

export async function runMixWebCodecs(job: MixJob, options: RunOptions = {}): Promise<WebCodecsOutput> {
  return drive((out): MixRequest => ({ type: 'mix', ...job, out }), options);
}

async function drive(request: (out: string) => WorkerRequest, { signal, onProgress }: RunOptions): Promise<WebCodecsOutput> {
  if (signal?.aborted) throw new EngineError('cancelled');
  const out = newOutputName();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let abort: () => void = () => {};
  const finish = new Promise<void>((resolve, reject) => {
    // A terminated worker says nothing: cancelling settles the wait itself.
    abort = () => reject(new EngineError('cancelled'));
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.ratio);
      else if (m.type === 'done') resolve();
      else reject(Object.assign(new Error(m.message), { name: m.name }));
    };
    worker.onerror = (e) => reject(new Error(e.message || 'worker failed'));
  });
  const onAbort = () => {
    worker.terminate();
    abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    worker.postMessage(request(out));
    await finish;
    onProgress?.(1);
    return { file: await readOutput(out), release: () => removeOutput(out) };
  } catch (e) {
    await removeOutput(out);
    if (signal?.aborted) throw new EngineError('cancelled');
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw QUOTA.test(message) ? new EngineError('out-of-memory', message) : classify(e);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}
