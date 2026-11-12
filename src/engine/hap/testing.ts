// Pictures and measures for the tests of HAP.

/** A picture with edges, a gradient and a little noise; deterministic. */
export function testPicture(w: number, h: number, shift = 0): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let seed = 12345 + shift;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0xffffffff) * 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = (x + shift) % 64 < 24 && y > h / 4 && y < (3 * h) / 4;
      out[i] = inside ? 230 : Math.min(255, (x * 255) / w + rnd());
      out[i + 1] = inside ? 40 : Math.min(255, (y * 255) / h + rnd());
      out[i + 2] = inside ? 40 : Math.min(255, 128 + 60 * Math.sin((x + y) / 9) + rnd());
      out[i + 3] = 255;
    }
  }
  return out;
}

/** PSNR of the color channels of two RGBA pictures. */
export function psnr(a: Uint8Array, b: Uint8Array): number {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c]! - b[i + c]!;
      se += d * d;
      n++;
    }
  }
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / se);
}

/** Bytes that do not compress. */
export function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}
