// What B sounds like: the kept range, the fades with ffmpeg's own curves and the gain normalizing
// will apply. Conversion (rate, bits, lossy codecs) is not imitated.

import { fittedFades, keptRange, rangeLength, type FileEdits, type Range, type Silences } from '../../model/edits.ts';
import type { Measurement } from '../../model/operations.ts';
import type { Curve, Fade, OutputSettings } from '../../model/settings.ts';

/** afade's curves (libavfilter/af_afade.c) for a position from 0 to 1 into the fade. */
export function fadeGain(curve: Curve, x: number): number {
  const g = Math.min(Math.max(x, 0), 1);
  switch (curve) {
    case 'tri':
      return g;
    case 'qsin':
      return Math.sin((g * Math.PI) / 2);
    case 'hsin':
      return (1 - Math.cos(g * Math.PI)) / 2;
    case 'esin':
      return 1 - Math.cos((Math.PI / 4) * ((2 * g - 1) ** 3 + 1));
    case 'log':
      return Math.min(Math.max(1 + 0.2 * Math.log10(g), 0), 1);
    case 'exp':
      return Math.exp(-11.512925464970227 * (1 - g));
  }
}

export interface Preview {
  range: Range;
  fadeIn: Fade;
  fadeOut: Fade;
  /** Linear gain of normalizing; 1 when it is off or not measured yet. */
  gain: number;
  /** Normalizing is on but its measurement has not arrived. */
  unmeasured: boolean;
}

/** Normalizing's gain in dB from its first pass. Loudness mode aims at the target loudness. */
export function normalizeDb(n: OutputSettings['normalize'], m: Measurement): number | null {
  if (n.mode === 'peak') return m.kind === 'volume' && Number.isFinite(m.maxVolume) ? n.peak - m.maxVolume : null;
  return m.kind === 'loudnorm' && Number.isFinite(m.i) ? n.lufs - m.i : null;
}

export function preview(
  edits: FileEdits,
  duration: number,
  settings: OutputSettings,
  silences: Silences | null | undefined,
  measurement: Measurement | null | undefined,
): Preview {
  const range = keptRange(edits, duration, settings.trim.silence ? silences : null);
  // Copying the track skips every process but the cut.
  const copy = settings.extract.mode === 'copy';
  const none: Fade = { duration: 0, curve: 'tri' };
  const fades = copy ? { fadeIn: none, fadeOut: none } : fittedFades(edits, rangeLength(range));
  const normalizing = !copy && settings.normalize.enabled;
  const db = normalizing && measurement ? normalizeDb(settings.normalize, measurement) : null;
  return { range, ...fades, gain: db === null ? 1 : 10 ** (db / 20), unmeasured: normalizing && !measurement };
}

/** B's gain at time t: silent outside the kept range. */
export function gainAt(p: Preview, t: number): number {
  const { start, end } = p.range;
  if (t < start || t >= end) return 0;
  let g = p.gain;
  if (p.fadeIn.duration > 0 && t < start + p.fadeIn.duration) g *= fadeGain(p.fadeIn.curve, (t - start) / p.fadeIn.duration);
  if (p.fadeOut.duration > 0 && t > end - p.fadeOut.duration) g *= fadeGain(p.fadeOut.curve, (end - t) / p.fadeOut.duration);
  return g;
}
