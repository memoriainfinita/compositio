// Draws the waveform on a canvas in device pixels: silences shaded, the part outside the region
// dimmed, the region's wave in the accent, the fade ramps with their curves. Colours come from the
// theme's custom properties, so both themes draw from the same code.

import type { Peaks } from '../../engine/index.ts';
import type { Silences } from '../../model/edits.ts';
import type { Fade } from '../../model/settings.ts';
import { fadeGain } from './preview.ts';
import { peakRange, timeToX, type View } from './view.ts';

export interface Colors {
  bg: string;
  wave: string;
  accent: string;
  dash: string;
  shade: string;
  dim: string;
}

export function themeColors(el: Element): Colors {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { bg: v('--inset'), wave: v('--wave'), accent: v('--accent'), dash: v('--dash'), shade: v('--accent-tint'), dim: v('--backdrop') };
}

export interface Scene {
  view: View;
  duration: number;
  peaks: Peaks | null;
  /** The region the user set: in and out. */
  region: { start: number; end: number } | null;
  fadeIn?: Fade;
  fadeOut?: Fade;
  silences?: Silences | null;
}

/** Fills the canvas; `width` and `height` in device pixels, `dpr` for line widths. */
export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, s: Scene, c: Colors): void {
  const { view } = s;
  const x = (t: number) => timeToX(t, width, view);
  const mid = height / 2;
  const amp = (height / 2) * 0.92;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, width, height);

  if (s.silences) {
    ctx.fillStyle = c.shade;
    if (s.silences.head > 0) ctx.fillRect(x(0), 0, x(s.silences.head) - x(0), height);
    if (s.silences.tail < s.duration) ctx.fillRect(x(s.silences.tail), 0, x(s.duration) - x(s.silences.tail), height);
  }

  const step = Math.max(1, Math.round(dpr));
  const end = x(s.duration);
  for (let px = Math.max(0, Math.floor(x(0))); px < Math.min(width, end); px += step) {
    const t0 = view.s + (px / width) * (view.e - view.s);
    const t1 = view.s + ((px + step) / width) * (view.e - view.s);
    const r = s.peaks ? peakRange(s.peaks, t0, t1) : null;
    const inside = !s.region || (t1 > s.region.start && t0 < s.region.end);
    if (!r) {
      // Not computed yet: a flat line where the wave will be.
      ctx.fillStyle = c.dash;
      ctx.fillRect(px, mid - dpr / 2, step, dpr);
      continue;
    }
    const y0 = mid - r[1] * amp;
    const y1 = mid - r[0] * amp;
    ctx.fillStyle = inside ? c.accent : c.wave;
    ctx.fillRect(px, y0, step, Math.max(step, y1 - y0));
  }

  if (s.region) {
    ctx.fillStyle = c.dim;
    const a = x(s.region.start);
    const b = x(s.region.end);
    if (a > 0) ctx.fillRect(0, 0, Math.min(a, width), height);
    if (b < width) ctx.fillRect(Math.max(b, 0), 0, width - Math.max(b, 0), height);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5 * dpr;
    if (s.fadeIn && s.fadeIn.duration > 0) ramp(ctx, x, s.region.start, s.fadeIn, height, 'in');
    if (s.fadeOut && s.fadeOut.duration > 0) ramp(ctx, x, s.region.end, s.fadeOut, height, 'out');
  }
}

/** The fade's gain as a line from silent (bottom) to full (top). */
function ramp(ctx: CanvasRenderingContext2D, x: (t: number) => number, edge: number, fade: Fade, height: number, side: 'in' | 'out'): void {
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const t = side === 'in' ? edge + k * fade.duration : edge - k * fade.duration;
    const y = height - fadeGain(fade.curve, k) * height;
    if (i === 0) ctx.moveTo(x(t), y);
    else ctx.lineTo(x(t), y);
  }
  ctx.stroke();
}
