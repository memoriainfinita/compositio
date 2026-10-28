// Output settings: the five steps of «Salida», in their fixed order. The batch has one full set;
// a file may override single values. Schemas are the source of the types and of the defaults.

import * as v from 'valibot';

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));

export const CURVES = ['tri', 'qsin', 'hsin', 'esin', 'log', 'exp'] as const;
export const CurveSchema = v.picklist(CURVES);
export type Curve = v.InferOutput<typeof CurveSchema>;

export const FadeSchema = v.object({ duration: seconds, curve: CurveSchema });
export type Fade = v.InferOutput<typeof FadeSchema>;

export const FORMATS = ['wav', 'flac', 'mp3', 'aac', 'opus', 'ogg'] as const;
export type Format = (typeof FORMATS)[number];

export const SAMPLE_RATES = [44100, 48000, 88200, 96000] as const;

const ExtractSchema = v.object({
  /** Audio track to keep, by position among the file's audio tracks. */
  track: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  mode: v.optional(v.picklist(['encode', 'copy']), 'encode'),
});

const TrimSchema = v.object({
  /** Cut the silences detected at the ends, on top of the file's in and out. */
  silence: v.optional(v.boolean(), false),
  /** MP3/AAC to the same format without re-encoding: cut at frame edges, no fades. */
  lossless: v.optional(v.boolean(), false),
});

const NormalizeSchema = v.object({
  enabled: v.optional(v.boolean(), false),
  mode: v.optional(v.picklist(['lufs', 'peak']), 'lufs'),
  lufs: v.optional(v.pipe(v.number(), v.minValue(-70), v.maxValue(-5)), -14),
  truePeak: v.optional(v.pipe(v.number(), v.minValue(-9), v.maxValue(0)), -1.5),
  lra: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50)), 11),
  peak: v.optional(v.pipe(v.number(), v.minValue(-30), v.maxValue(0)), -1),
});

const ConvertSchema = v.object({
  format: v.optional(v.picklist(FORMATS), 'wav'),
  sampleRate: v.optional(v.union([v.literal('source'), v.picklist(SAMPLE_RATES)]), 'source'),
  /** WAV and FLAC only; 32 is float in WAV and 24-bit in FLAC. */
  bitDepth: v.optional(v.picklist([16, 24, 32]), 24),
  channels: v.optional(v.union([v.literal('source'), v.picklist([1, 2])]), 'source'),
  dither: v.optional(v.boolean(), true),
  mp3: v.optional(
    v.object({
      mode: v.optional(v.picklist(['cbr', 'vbr']), 'cbr'),
      bitrate: v.optional(v.picklist([128, 160, 192, 256, 320]), 320),
      quality: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(9)), 0),
    }),
    {},
  ),
  aacBitrate: v.optional(v.picklist([128, 192, 256, 320]), 256),
  opusBitrate: v.optional(v.picklist([96, 128, 160, 192, 256]), 160),
  oggQuality: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)), 6),
  keepMetadata: v.optional(v.boolean(), true),
});

const OutputSchema = v.object({
  /** Tokens: {name} source name without extension, {n} position, {title}, {artist}. */
  pattern: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200)), '{name}'),
});

export const OutputSettingsSchema = v.object({
  extract: v.optional(ExtractSchema, {}),
  trim: v.optional(TrimSchema, {}),
  normalize: v.optional(NormalizeSchema, {}),
  convert: v.optional(ConvertSchema, {}),
  output: v.optional(OutputSchema, {}),
});
export type OutputSettings = v.InferOutput<typeof OutputSettingsSchema>;
export type Step = keyof OutputSettings;
export const STEPS: readonly Step[] = ['extract', 'trim', 'normalize', 'convert', 'output'];

/** A file's own values: only what differs from the batch, section by section. */
export const OverridesSchema = v.object({
  extract: v.optional(v.partial(ExtractSchema)),
  trim: v.optional(v.partial(TrimSchema)),
  normalize: v.optional(v.partial(NormalizeSchema)),
  convert: v.optional(v.partial(ConvertSchema)),
  output: v.optional(v.partial(OutputSchema)),
});
export type Overrides = v.InferOutput<typeof OverridesSchema>;

export const defaultSettings = (): OutputSettings => v.parse(OutputSettingsSchema, {});

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function effectiveSettings(batch: OutputSettings, own: Overrides): OutputSettings {
  const out = structuredClone(batch) as Record<Step, Record<string, unknown>>;
  for (const step of STEPS) {
    const section = own[step] as Record<string, unknown> | undefined;
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      if (value === undefined) continue;
      const base = out[step][key];
      out[step][key] = isPlainObject(base) && isPlainObject(value) ? { ...base, ...value } : value;
    }
  }
  return out as OutputSettings;
}

/** Keeps only the values that differ from the batch; an empty result means no own settings. */
export function pruneOverrides(batch: OutputSettings, own: Overrides): Overrides {
  const out: Record<string, Record<string, unknown>> = {};
  for (const step of STEPS) {
    const section = own[step] as Record<string, unknown> | undefined;
    if (!section) continue;
    const base = batch[step] as Record<string, unknown>;
    for (const [key, value] of Object.entries(section)) {
      // Spreading the base first keeps its key order, so the JSON comparison is fair.
      const merged = isPlainObject(value) && isPlainObject(base[key]) ? { ...base[key], ...value } : value;
      if (value === undefined || sameValue(merged, base[key])) continue;
      (out[step] ??= {})[key] = value;
    }
  }
  return out as Overrides;
}

export const hasOverrides = (batch: OutputSettings, own: Overrides): boolean =>
  Object.keys(pruneOverrides(batch, own)).length > 0;
