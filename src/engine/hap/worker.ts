// A worker that compresses frames: RGBA in, a HAP frame out.

import { hapFrame } from './frame.ts';
import { compressTexture, type HapVariant } from './texture.ts';

export interface EncodeRequest {
  id: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
  variant: HapVariant;
}

export interface EncodeReply {
  id: number;
  frame?: ArrayBuffer;
  error?: string;
}

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  const { id, rgba, width, height, variant } = e.data;
  try {
    const frame = hapFrame(compressTexture(new Uint8Array(rgba), width, height, variant), variant);
    // The frame is a view on a bigger buffer (snappy's bound): it is copied out to transfer.
    const out = frame.slice().buffer as ArrayBuffer;
    (self as unknown as Worker).postMessage({ id, frame: out } satisfies EncodeReply, [out]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String((error as Error)?.message ?? error) } satisfies EncodeReply);
  }
};
