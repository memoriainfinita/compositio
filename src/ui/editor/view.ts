// What the waveform shows: a stretch of time {s, e} over the width, as in aures. Zoom, pan and the
// conversions between seconds and pixels; the peaks a pixel column covers; times typed by people.

import type { Peaks } from '../../engine/index.ts';

export interface View {
  s: number;
  e: number;
}

/** The narrowest stretch the waveform zooms to, in seconds. */
export const MIN_SPAN = 0.05;

export const fit = (duration: number): View => ({ s: 0, e: Math.max(duration, MIN_SPAN) });

/** Keeps the span within [MIN_SPAN, duration] and the stretch inside the file. */
export function clampView(s: number, e: number, duration: number): View {
  const whole = Math.max(duration, MIN_SPAN);
  const span = Math.min(Math.max(e - s, MIN_SPAN), whole);
  const start = Math.min(Math.max(s, 0), whole - span);
  return { s: start, e: start + span };
}

/** Zooms by `factor` (below 1 zooms in) keeping time `t` under the same pixel. */
export function zoomAt(v: View, t: number, factor: number, duration: number): View {
  const span = (v.e - v.s) * factor;
  const frac = v.e > v.s ? (t - v.s) / (v.e - v.s) : 0.5;
  return clampView(t - span * frac, t - span * frac + span, duration);
}

export const pan = (v: View, dt: number, duration: number): View => clampView(v.s + dt, v.e + dt, duration);

/** Moves the view the least so that `t` is inside it. */
export function follow(v: View, t: number, duration: number): View {
  if (t >= v.s && t <= v.e) return v;
  const span = v.e - v.s;
  return clampView(t < v.s ? t : t - span, t < v.s ? t + span : t, duration);
}

export const timeToX = (t: number, width: number, v: View): number => ((t - v.s) / (v.e - v.s)) * width;
export const xToTime = (x: number, width: number, v: View): number => v.s + (x / width) * (v.e - v.s);

/** Lowest and highest value between two times; null where the peaks are not computed yet. */
export function peakRange(peaks: Peaks, t0: number, t1: number): [number, number] | null {
  if (t0 >= peaks.ready) return null;
  const n = peaks.min.length;
  const p0 = Math.min(Math.max(Math.floor(t0 * peaks.rate), 0), n - 1);
  const p1 = Math.min(Math.max(Math.ceil(Math.min(t1, peaks.ready) * peaks.rate), p0 + 1), n);
  let lo = 1;
  let hi = -1;
  for (let p = p0; p < p1; p++) {
    if (peaks.min[p]! < lo) lo = peaks.min[p]!;
    if (peaks.max[p]! > hi) hi = peaks.max[p]!;
  }
  return hi < lo ? [0, 0] : [lo, hi];
}

/**
 * Seconds from what people type: `1:02.5`, `0:01:02,500`, `62.5`. Commas count as decimal points.
 * Null when it does not read as a time.
 */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d*)?$/.test(p))) return null;
  if (parts.slice(0, -1).some((p) => p.includes('.'))) return null;
  const value = parts.reduce((total, p) => total * 60 + Number(p), 0);
  return Number.isFinite(value) ? value : null;
}
