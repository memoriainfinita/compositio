// What B sounds like: the kept range, the fades with ffmpeg's own curves and the gain normalizing
// will apply. Conversion (rate, bits, lossy codecs) is not imitated.

import { fittedFades, keptRange, rangeLength, type FileEdits, type Range, type Silences } from '../../model/edits.ts';
import { curveGain } from '../../model/curve.ts';
import type { Measurement } from '../../model/operations.ts';
import type { Fade, OutputSettings } from '../../model/settings.ts';

/** afade's curves, shared with the mix's picture (model/curve.ts). */
export const fadeGain = curveGain;

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
