// The engine's lowest layer: run one ffmpeg or ffprobe command over some input files and collect
// the named outputs. ffmpeg.wasm is the first implementation; a native local engine would be
// another. Inputs live under /in/<n>/ and outputs under /out/, whatever the implementation.

export interface RunRequest {
  inputs: readonly File[];
  args: readonly string[];
  /** Output names under /out/ to collect when the command succeeds. */
  outputs: readonly string[];
  tool?: 'ffmpeg' | 'ffprobe';
  /** Seconds of media the command goes through, for progress. */
  duration?: number;
}

export interface RunResult {
  code: number;
  log: readonly string[];
  files: ReadonlyMap<string, Blob>;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

export interface Runner {
  run(request: RunRequest, options?: RunOptions): Promise<RunResult>;
  dispose(): void;
}

/** Each input gets its own directory: two inputs may share a name. */
export const inputPath = (index: number, file: { name: string }): string => `/in/${index}/${file.name}`;
export const outputPath = (name: string): string => `/out/${name}`;

export type EngineErrorCode =
  | 'cancelled'
  | 'out-of-memory'
  | 'input-unreadable'
  | 'ffmpeg-failed'
  | 'load-failed'
  | 'unexpected-output'
  /** The plan refused the file (no audio track, empty range): the detail says why. */
  | 'invalid-input';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    /** Last lines of the log or the original message, for «Informar de un error». */
    readonly detail = '',
  ) {
    super(code);
    this.name = 'EngineError';
  }
}

const OOM = /memory access out of bounds|cannot enlarge memory|out of memory|aborted\(oom\)|array buffer allocation failed/i;
const UNREADABLE = /notreadableerror|notfounderror|input\/output error|i\/o error|could not be read/i;

const tail = (log: readonly string[], lines = 12): string => log.slice(-lines).join('\n');

/** Turns whatever went wrong into a code the interface can explain and recover from. */
export function classify(error: unknown, log: readonly string[] = [], aborted = false): EngineError {
  if (error instanceof EngineError) return error;
  if (aborted) return new EngineError('cancelled');
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  const text = `${message}\n${tail(log, 30)}`;
  if (OOM.test(text)) return new EngineError('out-of-memory', message);
  if (UNREADABLE.test(text)) return new EngineError('input-unreadable', message);
  return new EngineError('ffmpeg-failed', error === undefined ? tail(log) : `${message}\n${tail(log)}`);
}

export const failure = (log: readonly string[]): EngineError => classify(undefined, log);

/** `time=00:01:02.34` from ffmpeg's stats line, in seconds; null when the line has none. */
export function parseTime(line: string): number | null {
  const m = /time=\s*(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  const t = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? 0 : t;
}

/** Reports progress as a ratio, never going back and never above 1. */
export function progressTracker(duration: number | undefined, report?: (ratio: number) => void): (line: string) => void {
  let last = 0;
  return (line) => {
    if (!report || !duration || duration <= 0) return;
    const t = parseTime(line);
    if (t === null) return;
    const ratio = Math.min(1, t / duration);
    if (ratio > last) {
      last = ratio;
      report(ratio);
    }
  };
}
