// A group of workers that compress frames at the same time. Frames are independent, so the work
// spreads almost evenly; the caller keeps the order.

import type { EncodeReply, EncodeRequest } from './worker.ts';
import type { HapVariant } from './texture.ts';

export interface FrameEncoder {
  /** How many frames it can usefully have in flight. */
  readonly size: number;
  encode(rgba: ArrayBuffer, width: number, height: number, variant: HapVariant): Promise<Uint8Array>;
  close(): void;
}

/** One worker per spare core, between 1 and 6: the page and the decoder need theirs. */
export const poolSize = (cores: number = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2): number =>
  Math.max(1, Math.min(6, cores - 1));

interface Slot {
  worker: Worker;
  busy: number;
}

export class HapPool implements FrameEncoder {
  readonly size: number;
  private readonly slots: Slot[] = [];
  private readonly waiting = new Map<number, { resolve: (f: Uint8Array) => void; reject: (e: Error) => void; slot: Slot }>();
  private next = 0;

  constructor(size: number = poolSize()) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent<EncodeReply>) => {
        const w = this.waiting.get(e.data.id);
        if (!w) return;
        this.waiting.delete(e.data.id);
        slot.busy--;
        if (e.data.frame) w.resolve(new Uint8Array(e.data.frame));
        else w.reject(new Error(e.data.error ?? 'HAP worker failed'));
      };
      worker.onerror = (e) => this.fail(new Error(e.message || 'HAP worker failed'));
      this.slots.push(slot);
    }
  }

  encode(rgba: ArrayBuffer, width: number, height: number, variant: HapVariant): Promise<Uint8Array> {
    const slot = this.slots.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = this.next++;
    slot.busy++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ id, rgba, width, height, variant } satisfies EncodeRequest, [rgba]);
    });
  }

  private fail(error: Error): void {
    for (const w of this.waiting.values()) w.reject(error);
    this.waiting.clear();
  }

  close(): void {
    for (const s of this.slots) s.worker.terminate();
    this.fail(new Error('closed'));
  }
}
