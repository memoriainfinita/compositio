// The frames of the output, on a constant grid, from the frames of the input in presentation order:
// each output frame takes the latest input frame at or before its moment, repeating or skipping as
// ffmpeg's `fps` filter does. Speed scales the input's clock.

export interface Timed {
  timestamp: number;
}

export interface FramePlan {
  /** Seconds into the input where the kept range starts. */
  start: number;
  /** Seconds of the kept range. */
  length: number;
  speed: number;
  /** Output frames per second. */
  fps: number;
}

export const outputFrameCount = (p: FramePlan): number => Math.max(1, Math.round((p.length / p.speed) * p.fps));

/** Seconds of the input that output frame `k` shows. */
export const sourceTime = (p: FramePlan, k: number): number => p.start + (k / p.fps) * p.speed;

export interface Resampled<T> {
  frame: T;
  /** Position of the output frame on the grid. */
  index: number;
  /** Seconds of the output where the frame goes. */
  time: number;
  /** Seconds into the kept range of the input it shows, for fades. */
  within: number;
}

const EPSILON = 1e-6;

/**
 * Yields one entry per output frame. The input frames are not closed here: the caller owns the one
 * it was given until the next entry arrives, and `drop` receives those that were skipped.
 */
export async function* resample<T extends Timed>(frames: AsyncIterable<T>, p: FramePlan, drop: (frame: T) => void = () => {}): AsyncGenerator<Resampled<T>> {
  const it = frames[Symbol.asyncIterator]();
  const count = outputFrameCount(p);
  let current = (await it.next()).value as T | undefined;
  let next = current ? ((await it.next()).value as T | undefined) : undefined;
  try {
    if (!current) return;
    for (let k = 0; k < count; k++) {
      const at = sourceTime(p, k);
      while (next && next.timestamp <= at + EPSILON) {
        drop(current);
        current = next;
        next = (await it.next()).value as T | undefined;
      }
      yield { frame: current, index: k, time: k / p.fps, within: at - p.start };
    }
  } finally {
    if (current) drop(current);
    if (next) drop(next);
    await it.return?.();
  }
}

/** How opaque a frame is under fades to black: 1 in the middle, down to 0 at the very ends. */
export function fadeAlpha(within: number, length: number, fadeIn: number, fadeOut: number): number {
  let a = 1;
  if (fadeIn > 0) a = Math.min(a, within / fadeIn);
  if (fadeOut > 0) a = Math.min(a, (length - within) / fadeOut);
  return Math.max(0, Math.min(1, a));
}

/**
 * The input's frames read at times that only go forward, one at a time: `at(t)` gives the latest
 * frame at or before `t`. Used where a clip is read on a grid that is not its own (a mix). The
 * frame it returns stays open until the next call, which closes (`drop`) the ones it passed.
 */
export class FrameCursor<T extends Timed> {
  private readonly it: AsyncIterator<T>;
  private current: T | undefined;
  private next: T | undefined;
  private started = false;

  constructor(
    frames: AsyncIterable<T>,
    private readonly drop: (frame: T) => void = () => {},
  ) {
    this.it = frames[Symbol.asyncIterator]();
  }

  async at(time: number): Promise<T | undefined> {
    if (!this.started) {
      this.started = true;
      this.current = (await this.it.next()).value as T | undefined;
      this.next = this.current ? ((await this.it.next()).value as T | undefined) : undefined;
    }
    while (this.current && this.next && this.next.timestamp <= time + EPSILON) {
      this.drop(this.current);
      this.current = this.next;
      this.next = (await this.it.next()).value as T | undefined;
    }
    return this.current;
  }

  async close(): Promise<void> {
    if (this.current) this.drop(this.current);
    if (this.next) this.drop(this.next);
    this.current = this.next = undefined;
    await this.it.return?.();
  }
}
