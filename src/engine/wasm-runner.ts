// Runner on ffmpeg.wasm. The library runs ffmpeg in its own Worker; this only drives it. One
// instance runs one command at a time; cancelling terminates it and the next command loads a new one.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { classify, EngineError, inputPath, outputPath, progressTracker, type RunOptions, type RunRequest, type RunResult, type Runner } from './runner.ts';

export interface CoreUrls {
  coreURL: string;
  wasmURL: string;
  workerURL?: string;
}

/** URLs of a core copied under the site, absolute: the library's Worker resolves them. */
export function coreUrls(dir: string, base: string = document.baseURI): CoreUrls {
  const url = (file: string) => new URL(`${dir}${file}`, base).href;
  const urls: CoreUrls = { coreURL: url('ffmpeg-core.js'), wasmURL: url('ffmpeg-core.wasm') };
  if (dir.includes('core-mt')) urls.workerURL = url('ffmpeg-core.worker.js');
  return urls;
}

const ignore = () => {};

/**
 * The log level is global to the wasm instance: a previous `ffprobe -v error` would hide the
 * progress, loudnorm and silencedetect lines of the next command. Each command sets its own.
 */
export const withLogLevel = (args: readonly string[]): string[] =>
  args.includes('-loglevel') || args.includes('-v') ? [...args] : ['-loglevel', 'info', ...args];

export class WasmRunner implements Runner {
  #ff: FFmpeg | null = null;
  #loading: Promise<FFmpeg> | null = null;
  #onLine: (line: string) => void = ignore;
  #busy = false;

  constructor(private readonly urls: CoreUrls) {}

  #instance(): Promise<FFmpeg> {
    this.#loading ??= (async () => {
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => this.#onLine(message));
      try {
        await ff.load(this.urls);
      } catch (e) {
        ff.terminate();
        this.#loading = null;
        throw new EngineError('load-failed', String((e as Error)?.message ?? e));
      }
      this.#ff = ff;
      return ff;
    })();
    return this.#loading;
  }

  /** Drops the instance; the next run loads a fresh one. */
  #discard(): void {
    this.#ff?.terminate();
    this.#ff = null;
    this.#loading = null;
  }

  async run(req: RunRequest, { signal, onProgress }: RunOptions = {}): Promise<RunResult> {
    if (this.#busy) throw new Error('WasmRunner runs one command at a time');
    if (signal?.aborted) throw new EngineError('cancelled');
    this.#busy = true;
    const log: string[] = [];
    const track = progressTracker(req.duration, onProgress);
    let aborted = false;
    let stale = false;
    const onAbort = () => {
      aborted = true;
      this.#discard();
    };
    try {
      const ff = await this.#instance();
      if (signal?.aborted) throw new EngineError('cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#onLine = (line) => {
        log.push(line);
        track(line);
      };

      await ff.createDir('/in').catch(ignore);
      await ff.createDir('/out').catch(ignore);
      const mounted: string[] = [];
      try {
        for (const [i, file] of req.inputs.entries()) {
          const dir = inputPath(i, file).slice(0, -file.name.length - 1);
          await ff.createDir(dir).catch(ignore);
          await ff.mount('WORKERFS' as never, { files: [file] }, dir);
          mounted.push(dir);
        }
        const code = req.tool === 'ffprobe' ? await ff.ffprobe([...req.args]) : await ff.exec(withLogLevel(req.args));
        // A failed ffmpeg run can leave the instance broken ("Aborted()"): the next command
        // gets a fresh one. ffprobe always exits with -1, so it does not count.
        if (code !== 0 && req.tool !== 'ffprobe') stale = true;
        // Whatever outputs exist are collected: ffprobe in ffmpeg.wasm exits with -1 even when it
        // succeeds, so the exit code alone cannot tell. Jobs decide what a missing output means.
        const files = new Map<string, Blob>();
        for (const name of req.outputs) {
          const data = await ff.readFile(outputPath(name)).catch(() => null);
          if (data === null) continue;
          if (typeof data === 'string') throw new EngineError('unexpected-output', name);
          // The copy leaves wasm memory; the file there is deleted right after.
          files.set(name, new Blob([data as Uint8Array<ArrayBuffer>]));
          await ff.deleteFile(outputPath(name)).catch(ignore);
        }
        return { code, log, files };
      } finally {
        if (stale) this.#discard();
        else if (!aborted && this.#ff === ff) {
          for (const name of req.outputs) await ff.deleteFile(outputPath(name)).catch(ignore);
          for (const dir of mounted) {
            await ff.unmount(dir).catch(ignore);
            await ff.deleteDir(dir).catch(ignore);
          }
        }
      }
    } catch (e) {
      const error = classify(e, log, aborted || signal?.aborted);
      // After a crash the instance may be broken; a fresh one costs under a second.
      if (error.code !== 'load-failed') this.#discard();
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.#onLine = ignore;
      this.#busy = false;
    }
  }

  async load(): Promise<void> {
    await this.#instance();
  }

  dispose(): void {
    this.#discard();
  }
}
