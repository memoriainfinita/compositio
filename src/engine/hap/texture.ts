// Texture compression for HAP: DXT1 for Hap, and scaled YCoCg in DXT5 for Hap Q. RGBA in, blocks of
// 4x4 pixels out; width and height are multiples of 4. Each block takes its principal color axis, puts
// the two endpoints on it and refines them by least squares.

import type { HapVariant } from '../../model/settings.ts';

export type { HapVariant };

/** Bytes of a compressed texture: 8 per block for DXT1, 16 for DXT5. */
export const textureBytes = (variant: HapVariant, width: number, height: number): number => (width * height * (variant === 'hapq' ? 16 : 8)) / 16;

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

const PAL = new Float64Array(12);
const WTS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [2 / 3, 1 / 3], [1 / 3, 2 / 3]];
const M = { indices: 0, err: 0 };
const E0 = new Float64Array(3);
const E1 = new Float64Array(3);

/** `blue5` fixes the 5-bit blue of both endpoints (Hap Q keeps its scale there), or -1. */
const c565 = (r: number, g: number, b: number, blue5: number): number => ((r >> 3) << 11) | ((g >> 2) << 5) | (blue5 >= 0 ? blue5 : b >> 3);

function expand(c: number, out: Float64Array): void {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  out[0] = (r << 3) | (r >> 2);
  out[1] = (g << 2) | (g >> 4);
  out[2] = (b << 3) | (b >> 2);
}

/** Nearest of the four palette colors for each of the 16 pixels; fills M. */
function match(px: Float64Array, e0: number, e1: number): void {
  expand(e0, E0);
  expand(e1, E1);
  for (let c = 0; c < 3; c++) {
    PAL[c] = E0[c]!;
    PAL[3 + c] = E1[c]!;
    PAL[6 + c] = (2 * E0[c]! + E1[c]!) / 3;
    PAL[9 + c] = (E0[c]! + 2 * E1[c]!) / 3;
  }
  let indices = 0;
  let err = 0;
  for (let p = 0; p < 16; p++) {
    const r = px[p * 3]!;
    const g = px[p * 3 + 1]!;
    const b = px[p * 3 + 2]!;
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < 4; c++) {
      const dr = r - PAL[c * 3]!;
      const dg = g - PAL[c * 3 + 1]!;
      const db = b - PAL[c * 3 + 2]!;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    indices |= best << (p * 2);
    err += bd;
  }
  M.indices = indices >>> 0;
  M.err = err;
}

function put565(out: Uint8Array, o: number, e0: number, e1: number, indices: number): void {
  out[o] = e0 & 255;
  out[o + 1] = e0 >> 8;
  out[o + 2] = e1 & 255;
  out[o + 3] = e1 >> 8;
  out[o + 4] = indices & 255;
  out[o + 5] = (indices >>> 8) & 255;
  out[o + 6] = (indices >>> 16) & 255;
  out[o + 7] = (indices >>> 24) & 255;
}

/** One 8-byte color block from 16 pixels of three channels (0 to 255, as numbers). */
function colorBlock(px: Float64Array, out: Uint8Array, o: number, blue5: number): void {
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let flat = true;
  const r0 = px[0]!;
  const g0 = px[1]!;
  const b0 = px[2]!;
  for (let p = 0; p < 16; p++) {
    const r = px[p * 3]!;
    const g = px[p * 3 + 1]!;
    const b = px[p * 3 + 2]!;
    mr += r;
    mg += g;
    mb += b;
    if (r !== r0 || g !== g0 || b !== b0) flat = false;
  }
  if (flat) {
    const c = c565(r0, g0, b0, blue5);
    put565(out, o, c, c, 0);
    return;
  }
  mr /= 16;
  mg /= 16;
  mb /= 16;
  // The covariance, and its principal axis by power iteration.
  let cxx = 0;
  let cxy = 0;
  let cxz = 0;
  let cyy = 0;
  let cyz = 0;
  let czz = 0;
  for (let p = 0; p < 16; p++) {
    const r = px[p * 3]! - mr;
    const g = px[p * 3 + 1]! - mg;
    const b = px[p * 3 + 2]! - mb;
    cxx += r * r;
    cxy += r * g;
    cxz += r * b;
    cyy += g * g;
    cyz += g * b;
    czz += b * b;
  }
  let ax = 0.57735;
  let ay = 0.57735;
  let az = 0.57735;
  for (let it = 0; it < 6; it++) {
    const nx = cxx * ax + cxy * ay + cxz * az;
    const ny = cxy * ax + cyy * ay + cyz * az;
    const nz = cxz * ax + cyz * ay + czz * az;
    const len = Math.hypot(nx, ny, nz) || 1;
    ax = nx / len;
    ay = ny / len;
    az = nz / len;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let p = 0; p < 16; p++) {
    const t = (px[p * 3]! - mr) * ax + (px[p * 3 + 1]! - mg) * ay + (px[p * 3 + 2]! - mb) * az;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  // The endpoints on the axis, a little inside the extremes.
  const inset = (hi - lo) / 16;
  lo += inset;
  hi -= inset;
  let e0 = c565(clamp8(mr + ax * hi), clamp8(mg + ay * hi), clamp8(mb + az * hi), blue5);
  let e1 = c565(clamp8(mr + ax * lo), clamp8(mg + ay * lo), clamp8(mb + az * lo), blue5);
  let bestE0 = 0;
  let bestE1 = 0;
  let bestIdx = 0;
  let bestErr = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    if (e0 === e1) {
      if (bestErr === Infinity) {
        bestE0 = e0;
        bestE1 = e1;
        bestIdx = 0;
      }
      break;
    }
    // Endpoint order picks the four-color mode.
    if (e0 < e1) {
      const t = e0;
      e0 = e1;
      e1 = t;
    }
    match(px, e0, e1);
    if (M.err < bestErr) {
      bestE0 = e0;
      bestE1 = e1;
      bestIdx = M.indices;
      bestErr = M.err;
    }
    if (M.err === 0) break;
    // Least squares for the endpoints given the chosen indices.
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let br = 0;
    let bg = 0;
    let bb = 0;
    let cr = 0;
    let cg = 0;
    let cb = 0;
    for (let p = 0; p < 16; p++) {
      const w = WTS[(M.indices >>> (p * 2)) & 3]!;
      const wa = w[0];
      const wb = w[1];
      a11 += wa * wa;
      a12 += wa * wb;
      a22 += wb * wb;
      const r = px[p * 3]!;
      const g = px[p * 3 + 1]!;
      const b = px[p * 3 + 2]!;
      br += wa * r;
      bg += wa * g;
      bb += wa * b;
      cr += wb * r;
      cg += wb * g;
      cb += wb * b;
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-6) break;
    e0 = c565(clamp8(Math.round((a22 * br - a12 * cr) / det)), clamp8(Math.round((a22 * bg - a12 * cg) / det)), clamp8(Math.round((a22 * bb - a12 * cb) / det)), blue5);
    e1 = c565(clamp8(Math.round((a11 * cr - a12 * br) / det)), clamp8(Math.round((a11 * cg - a12 * bg) / det)), clamp8(Math.round((a11 * cb - a12 * bb) / det)), blue5);
  }
  put565(out, o, bestE0, bestE1, bestIdx);
}

const AL = new Float64Array(8);

/** One 8-byte DXT5 alpha block from 16 values (0 to 255). */
function alphaBlock(a: Float64Array, out: Uint8Array, o: number): void {
  let lo = 255;
  let hi = 0;
  for (let p = 0; p < 16; p++) {
    const v = Math.round(a[p]!);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  out.fill(0, o, o + 8);
  out[o] = hi;
  out[o + 1] = lo;
  if (hi === lo) return;
  // a0 > a1: the eight levels are the two ends and six steps between them.
  AL[0] = hi;
  AL[1] = lo;
  for (let i = 0; i < 6; i++) AL[2 + i] = ((6 - i) * hi + (1 + i) * lo) / 7;
  let low = 0;
  let high = 0;
  for (let p = 0; p < 16; p++) {
    const v = a[p]!;
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < 8; c++) {
      const d = Math.abs(v - AL[c]!);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (p < 8) low |= best << (3 * p);
    else high |= best << (3 * (p - 8));
  }
  out[o + 2] = low & 255;
  out[o + 3] = (low >> 8) & 255;
  out[o + 4] = (low >> 16) & 255;
  out[o + 5] = high & 255;
  out[o + 6] = (high >> 8) & 255;
  out[o + 7] = (high >> 16) & 255;
}

/** rgba: width x height x 4 bytes, both multiples of 4. */
export function compressTexture(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, variant: HapVariant): Uint8Array {
  if (width % 4 || height % 4) throw new RangeError('HAP needs a width and a height that are multiples of 4');
  const out = new Uint8Array(textureBytes(variant, width, height));
  const px = new Float64Array(48);
  const ys = new Float64Array(16);
  const q = variant === 'hapq';
  let o = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let k = 0;
      if (!q) {
        for (let y = 0; y < 4; y++) {
          let i = ((by + y) * width + bx) * 4;
          for (let x = 0; x < 4; x++, i += 4, k += 3) {
            px[k] = rgba[i]!;
            px[k + 1] = rgba[i + 1]!;
            px[k + 2] = rgba[i + 2]!;
          }
        }
        colorBlock(px, out, o, -1);
        o += 8;
        continue;
      }
      // Y goes to the alpha block; Co and Cg, scaled up when the block has little color, and the scale
      // itself in blue, go to the color block.
      let maxChroma = 0;
      let p = 0;
      for (let y = 0; y < 4; y++) {
        let i = ((by + y) * width + bx) * 4;
        for (let x = 0; x < 4; x++, i += 4, k += 3, p++) {
          const r = rgba[i]!;
          const g = rgba[i + 1]!;
          const b = rgba[i + 2]!;
          const co = (r - b) / 2;
          const cg = (2 * g - r - b) / 4;
          px[k] = co;
          px[k + 1] = cg;
          ys[p] = (r + 2 * g + b) / 4;
          maxChroma = Math.max(maxChroma, Math.abs(co), Math.abs(cg));
        }
      }
      const scale = maxChroma < 32 ? 4 : maxChroma < 64 ? 2 : 1;
      for (let n = 0; n < 16; n++) {
        px[n * 3] = clamp8(px[n * 3]! * scale + 128);
        px[n * 3 + 1] = clamp8(px[n * 3 + 1]! * scale + 128);
        px[n * 3 + 2] = (scale - 1) * 8;
      }
      alphaBlock(ys, out, o);
      colorBlock(px, out, o + 8, scale - 1);
      o += 16;
    }
  }
  return out;
}

/** The inverse, for tests and checks: a texture back to RGBA. */
export function decompressTexture(data: Uint8Array, width: number, height: number, variant: HapVariant): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const q = variant === 'hapq';
  const blockSize = q ? 16 : 8;
  const e0 = new Float64Array(3);
  const e1 = new Float64Array(3);
  let o = 0;
  const col = new Float64Array(12);
  const al = new Float64Array(8);
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4, o += blockSize) {
      const c = o + (q ? 8 : 0);
      const c0 = data[c]! | (data[c + 1]! << 8);
      const c1 = data[c + 2]! | (data[c + 3]! << 8);
      expand(c0, e0);
      expand(c1, e1);
      for (let i = 0; i < 3; i++) {
        col[i] = e0[i]!;
        col[3 + i] = e1[i]!;
        col[6 + i] = (2 * e0[i]! + e1[i]!) / 3;
        col[9 + i] = (e0[i]! + 2 * e1[i]!) / 3;
      }
      const idx = (data[c + 4]! | (data[c + 5]! << 8) | (data[c + 6]! << 16) | (data[c + 7]! << 24)) >>> 0;
      let abits = 0;
      let bits2 = 0;
      if (q) {
        const a0 = data[o]!;
        const a1 = data[o + 1]!;
        al[0] = a0;
        al[1] = a1;
        if (a0 > a1) for (let i = 0; i < 6; i++) al[2 + i] = ((6 - i) * a0 + (1 + i) * a1) / 7;
        else {
          for (let i = 0; i < 4; i++) al[2 + i] = ((4 - i) * a0 + (1 + i) * a1) / 5;
          al[6] = 0;
          al[7] = 255;
        }
        abits = data[o + 2]! | (data[o + 3]! << 8) | (data[o + 4]! << 16);
        bits2 = data[o + 5]! | (data[o + 6]! << 8) | (data[o + 7]! << 16);
      }
      for (let p = 0; p < 16; p++) {
        const sel = (idx >>> (p * 2)) & 3;
        let r = col[sel * 3]!;
        let g = col[sel * 3 + 1]!;
        let b = col[sel * 3 + 2]!;
        if (q) {
          const y = al[p < 8 ? (abits >> (3 * p)) & 7 : (bits2 >> (3 * (p - 8))) & 7]!;
          const scale = (Math.round(b) >> 3) + 1;
          const co = (r - 128) / scale;
          const cg = (g - 128) / scale;
          r = y + co - cg;
          g = y + cg;
          b = y - co - cg;
        }
        const x = bx + (p & 3);
        const yy = by + (p >> 2);
        const i = (yy * width + x) * 4;
        out[i] = clamp8(Math.round(r));
        out[i + 1] = clamp8(Math.round(g));
        out[i + 2] = clamp8(Math.round(b));
        out[i + 3] = 255;
      }
    }
  }
  return out;
}
