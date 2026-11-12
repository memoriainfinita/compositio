// A HAP frame: one texture section, with its header, compressed by snappy when that makes it smaller.

import { snappy } from './snappy.ts';
import type { HapVariant } from './texture.ts';

/** Section type nibble (texture format) and the fourcc of each variant. */
const TEXTURE_TYPE: Record<HapVariant, number> = { hap: 0x0b, hapq: 0x0f };
export const FOURCC: Record<HapVariant, string> = { hap: 'Hap1', hapq: 'HapY' };

const NONE = 0xa0;
const SNAPPY = 0xb0;

export function hapFrame(texture: Uint8Array, variant: HapVariant): Uint8Array {
  let body = texture;
  let compressor = NONE;
  const s = snappy(texture);
  if (s.length < texture.length) {
    body = s;
    compressor = SNAPPY;
  }
  const type = compressor | TEXTURE_TYPE[variant];
  const extended = body.length >= 0x1000000;
  const head = extended ? 8 : 4;
  const out = new Uint8Array(head + body.length);
  if (extended) {
    // Three zero bytes, the type, then the length in four bytes.
    out[3] = type;
    new DataView(out.buffer).setUint32(4, body.length, true);
  } else {
    out[0] = body.length & 255;
    out[1] = (body.length >> 8) & 255;
    out[2] = body.length >> 16;
    out[3] = type;
  }
  out.set(body, head);
  return out;
}
