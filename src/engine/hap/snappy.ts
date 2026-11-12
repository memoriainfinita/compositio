// Snappy's raw block format: what HAP's second stage uses. Greedy matching with a hash of four bytes.

const HASH_BITS = 14;

/** The worst case: literals only, with their tags. */
export const snappyBound = (n: number): number => 32 + n + Math.floor(n / 6);

export function snappy(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out = new Uint8Array(snappyBound(n));
  let o = 0;
  let v = n;
  while (v >= 0x80) {
    out[o++] = (v & 0x7f) | 0x80;
    v >>>= 7;
  }
  out[o++] = v;

  const word = (i: number): number => (src[i]! | (src[i + 1]! << 8) | (src[i + 2]! << 16) | (src[i + 3]! << 24)) >>> 0;
  const literal = (from: number, to: number): void => {
    const len = to - from;
    if (len <= 0) return;
    const l = len - 1;
    if (l < 60) out[o++] = l << 2;
    else if (l < 256) {
      out[o++] = 60 << 2;
      out[o++] = l;
    } else if (l < 65536) {
      out[o++] = 61 << 2;
      out[o++] = l & 255;
      out[o++] = l >> 8;
    } else {
      out[o++] = 62 << 2;
      out[o++] = l & 255;
      out[o++] = (l >> 8) & 255;
      out[o++] = l >> 16;
    }
    out.set(src.subarray(from, to), o);
    o += len;
  };
  // Copies of 1 to 64 bytes with a two-byte offset.
  const copy = (offset: number, length: number): void => {
    let len = length;
    while (len > 0) {
      const l = Math.min(len, 64);
      out[o++] = ((l - 1) << 2) | 2;
      out[o++] = offset & 255;
      out[o++] = offset >> 8;
      len -= l;
    }
  };

  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  let lit = 0;
  let i = 0;
  const limit = n - 4;
  while (i <= limit) {
    const w = word(i);
    const h = Math.imul(w, 0x1e35a7bd) >>> (32 - HASH_BITS);
    const cand = table[h]!;
    table[h] = i;
    if (cand >= 0 && i - cand < 65536 && word(cand) === w) {
      let len = 4;
      while (i + len < n && src[cand + len] === src[i + len]) len++;
      literal(lit, i);
      copy(i - cand, len);
      i += len;
      lit = i;
    } else {
      i++;
    }
  }
  literal(lit, n);
  return out.subarray(0, o);
}

/** The inverse, for tests. */
export function unsnappy(src: Uint8Array): Uint8Array {
  let i = 0;
  let n = 0;
  for (let shift = 0; ; shift += 7) {
    const b = src[i++]!;
    n |= (b & 0x7f) << shift;
    if (b < 0x80) break;
  }
  const out = new Uint8Array(n);
  let o = 0;
  while (i < src.length) {
    const tag = src[i++]!;
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const extra = len - 59;
        len = 0;
        for (let k = 0; k < extra; k++) len |= src[i++]! << (8 * k);
      }
      len += 1;
      out.set(src.subarray(i, i + len), o);
      i += len;
      o += len;
    } else {
      let len: number;
      let offset: number;
      if (kind === 1) {
        len = ((tag >> 2) & 7) + 4;
        offset = ((tag >> 5) << 8) | src[i++]!;
      } else if (kind === 2) {
        len = (tag >> 2) + 1;
        offset = src[i]! | (src[i + 1]! << 8);
        i += 2;
      } else {
        len = (tag >> 2) + 1;
        offset = (src[i]! | (src[i + 1]! << 8) | (src[i + 2]! << 16) | (src[i + 3]! << 24)) >>> 0;
        i += 4;
      }
      for (let k = 0; k < len; k++, o++) out[o] = out[o - offset]!;
    }
  }
  return out;
}
