// Operations are declarative: each step of «Salida» says which tracks it touches and adds its part
// to an ffmpeg command. Nothing here runs ffmpeg; the engine runs the plan. Video operations will
// join the same list.

import { audioTracks, ffTime, isVideo, LOSSY_AUDIO, type AudioTrack, type MediaInfo } from './media.ts';
import { fittedFades, keptRange, rangeLength, type FileEdits, type Silences } from './edits.ts';
import type { Format, OutputSettings, Step } from './settings.ts';

export interface PlanInput {
  info: MediaInfo;
  edits: FileEdits;
  /** Effective settings: the batch with the file's own values applied. */
  settings: OutputSettings;
  silences?: Silences | null;
  inputPath: string;
  outputPath: string;
}

export type Measurement =
  | { kind: 'loudnorm'; i: number; tp: number; lra: number; thresh: number; offset: number }
  | { kind: 'volume'; maxVolume: number };

export type Warning =
  | 'lossy-reencode'
  | 'lossless-unavailable'
  | 'copy-ignores-processing'
  | 'rate-adjusted'
  | 'fades-shortened';

export type PlanError = 'no-audio-track' | 'empty-range' | 'silent-input' | 'missing-measurement';

export interface JobPlan {
  /** First pass, when normalizing: its stderr goes to `parseMeasurement`. */
  measure: { kind: Measurement['kind']; args: string[] } | null;
  render(measurement?: Measurement | null): string[] | { error: PlanError };
  extension: string;
  warnings: Warning[];
}

type Mode = 'encode' | 'copy-track' | 'copy-trim';

export interface Context {
  input: PlanInput;
  track: AudioTrack;
  mode: Mode;
  start: number;
  length: number;
  trimmed: boolean;
  format: Format;
  rate: number;
  warnings: Warning[];
}

export interface Draft {
  inputOptions: string[];
  maps: string[];
  filters: string[];
  codec: string[];
  muxer: string[];
}

export interface Operation {
  id: Step;
  tracks: readonly ('audio' | 'video')[];
  /** Adds this step's arguments. `measurement` is null in the measuring pass. */
  apply(draft: Draft, ctx: Context, measurement: Measurement | null): void | { error: PlanError };
}

const FORMAT_CODEC: Record<Format, string> = {
  wav: 'pcm',
  flac: 'flac',
  mp3: 'mp3',
  aac: 'aac',
  opus: 'opus',
  ogg: 'vorbis',
};

const FORMAT_EXT: Record<Format, string> = { wav: 'wav', flac: 'flac', mp3: 'mp3', aac: 'm4a', opus: 'opus', ogg: 'ogg' };
const FORMAT_MUXER: Record<Format, string> = { wav: 'wav', flac: 'flac', mp3: 'mp3', aac: 'ipod', opus: 'opus', ogg: 'ogg' };
const COVER_MUXERS = new Set(['mp3', 'flac', 'ipod']);

/** Extension and muxer for a track copied as it is. */
export function copyTarget(codec: string): { ext: string; muxer: string } {
  if (codec.startsWith('pcm_')) return { ext: 'wav', muxer: 'wav' };
  const known: Record<string, { ext: string; muxer: string }> = {
    mp3: { ext: 'mp3', muxer: 'mp3' },
    aac: { ext: 'm4a', muxer: 'ipod' },
    alac: { ext: 'm4a', muxer: 'ipod' },
    flac: { ext: 'flac', muxer: 'flac' },
    opus: { ext: 'opus', muxer: 'opus' },
    vorbis: { ext: 'ogg', muxer: 'ogg' },
  };
  return known[codec] ?? { ext: 'mka', muxer: 'matroska' };
}

/** Output sample rate: the source's or the chosen one, within what the codec accepts. */
function targetRate(s: OutputSettings, track: AudioTrack): number {
  const wanted = s.convert.sampleRate === 'source' ? track.sampleRate : s.convert.sampleRate;
  if (s.convert.format === 'opus') return 48000;
  if (s.convert.format === 'mp3') return Math.min(wanted, 48000);
  return wanted;
}

const hasFades = (e: FileEdits): boolean => e.fadeIn.duration > 0 || e.fadeOut.duration > 0;

const extract: Operation = {
  id: 'extract',
  tracks: ['audio'],
  apply(d, ctx) {
    d.maps.push('-map', `0:a:${ctx.track.index}`);
    if (ctx.mode === 'copy-track') d.codec.push('-c:a', 'copy');
  },
};

const trim: Operation = {
  id: 'trim',
  tracks: ['audio', 'video'],
  apply(d, ctx) {
    if (ctx.trimmed) d.inputOptions.push('-ss', ffTime(ctx.start), '-t', ffTime(ctx.length));
    if (ctx.mode !== 'encode') return;
    const { fadeIn, fadeOut } = fittedFades(ctx.input.edits, ctx.length);
    if (fadeIn.duration > 0) d.filters.push(`afade=t=in:st=0:d=${ffTime(fadeIn.duration)}:curve=${fadeIn.curve}`);
    if (fadeOut.duration > 0) {
      const st = ffTime(ctx.length - fadeOut.duration);
      d.filters.push(`afade=t=out:st=${st}:d=${ffTime(fadeOut.duration)}:curve=${fadeOut.curve}`);
    }
  },
};

const normalize: Operation = {
  id: 'normalize',
  tracks: ['audio'],
  apply(d, ctx, m) {
    const n = ctx.input.settings.normalize;
    if (ctx.mode !== 'encode' || !n.enabled) return;
    if (n.mode === 'peak') {
      if (!m) return void d.filters.push('volumedetect');
      if (m.kind !== 'volume') return { error: 'missing-measurement' };
      if (!Number.isFinite(m.maxVolume)) return { error: 'silent-input' };
      d.filters.push(`volume=${(n.peak - m.maxVolume).toFixed(2)}dB`);
      return;
    }
    const target = `I=${n.lufs}:TP=${n.truePeak}:LRA=${n.lra}`;
    if (!m) return void d.filters.push(`loudnorm=${target}:print_format=json`);
    if (m.kind !== 'loudnorm') return { error: 'missing-measurement' };
    if (![m.i, m.tp, m.lra, m.thresh].every(Number.isFinite)) return { error: 'silent-input' };
    d.filters.push(
      `loudnorm=${target}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}` +
        `:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=summary`,
    );
  },
};

const convert: Operation = {
  id: 'convert',
  tracks: ['audio'],
  apply(d, ctx) {
    if (ctx.mode === 'copy-trim') d.codec.push('-c:a', 'copy');
    if (ctx.mode !== 'encode') return;
    const c = ctx.input.settings.convert;
    const deep = c.format === 'wav' || c.format === 'flac' ? c.bitDepth : null;
    // Lossy sources decode to float, so they count as deeper than 16 bits.
    const dither = deep === 16 && c.dither && (ctx.track.bitDepth ?? 32) > 16;
    // loudnorm works at 192 kHz, so after it the rate is always set back.
    const resample = ctx.rate !== ctx.track.sampleRate || ctx.input.settings.normalize.enabled || dither;
    if (resample) d.filters.push(`aresample=${ctx.rate}${dither ? ':osf=s16:dither_method=triangular' : ''}`);
    if (c.channels !== 'source') d.codec.push('-ac', String(c.channels));
    switch (c.format) {
      case 'wav':
        d.codec.push('-c:a', { 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_f32le' }[c.bitDepth]);
        break;
      case 'flac':
        d.codec.push('-c:a', 'flac', ...(c.bitDepth === 16 ? ['-sample_fmt', 's16'] : ['-sample_fmt', 's32', '-bits_per_raw_sample', '24']));
        break;
      case 'mp3':
        d.codec.push('-c:a', 'libmp3lame', ...(c.mp3.mode === 'cbr' ? ['-b:a', `${c.mp3.bitrate}k`] : ['-q:a', String(c.mp3.quality)]));
        break;
      case 'aac':
        d.codec.push('-c:a', 'aac', '-b:a', `${c.aacBitrate}k`);
        break;
      case 'opus':
        d.codec.push('-c:a', 'libopus', '-b:a', `${c.opusBitrate}k`);
        break;
      case 'ogg':
        d.codec.push('-c:a', 'libvorbis', '-q:a', String(c.oggQuality));
        break;
    }
  },
};

const output: Operation = {
  id: 'output',
  tracks: ['audio', 'video'],
  apply(d, ctx) {
    const { info, settings } = ctx.input;
    const muxer = ctx.mode === 'encode' ? FORMAT_MUXER[ctx.format] : copyTarget(ctx.track.codec).muxer;
    if (!settings.convert.keepMetadata) {
      d.muxer.push('-map_metadata', '-1');
    } else {
      d.muxer.push('-map_metadata', '0');
      if (info.hasCover && !isVideo(info) && COVER_MUXERS.has(muxer)) {
        d.maps.push('-map', '0:v:0?');
        d.codec.push('-c:v', 'copy', '-disposition:v:0', 'attached_pic');
      }
      if (muxer === 'mp3') d.muxer.push('-id3v2_version', '3');
    }
    d.muxer.push('-f', muxer);
  },
};

/** The steps of «Salida», in their fixed order. */
export const OPERATIONS: readonly Operation[] = [extract, trim, normalize, convert, output];

function chooseMode(input: PlanInput, track: AudioTrack, warnings: Warning[]): Mode {
  const s = input.settings;
  if (s.extract.mode === 'copy') {
    if (hasFades(input.edits) || s.normalize.enabled) warnings.push('copy-ignores-processing');
    return 'copy-track';
  }
  if (!s.trim.lossless) return 'encode';
  const sameCodec = (track.codec === 'mp3' || track.codec === 'aac') && FORMAT_CODEC[s.convert.format] === track.codec;
  const untouched =
    !hasFades(input.edits) &&
    !s.normalize.enabled &&
    (s.convert.sampleRate === 'source' || s.convert.sampleRate === track.sampleRate) &&
    (s.convert.channels === 'source' || s.convert.channels === track.channels);
  if (sameCodec && untouched) return 'copy-trim';
  warnings.push('lossless-unavailable');
  return 'encode';
}

export function plan(input: PlanInput): JobPlan | { error: PlanError } {
  const { info, edits, settings } = input;
  const tracks = audioTracks(info);
  const track = tracks.find((t) => t.index === settings.extract.track) ?? tracks[0];
  if (!track) return { error: 'no-audio-track' };

  const range = keptRange(edits, info.duration, settings.trim.silence ? input.silences : null);
  const length = rangeLength(range);
  if (length === 0) return { error: 'empty-range' };
  const trimmed = range.start > 0 || range.end < info.duration;

  const warnings: Warning[] = [];
  const mode = chooseMode(input, track, warnings);
  const format = settings.convert.format;
  if (mode === 'encode') {
    if (LOSSY_AUDIO.has(track.codec) && LOSSY_AUDIO.has(FORMAT_CODEC[format])) warnings.push('lossy-reencode');
    if (fittedFades(edits, length).fadeIn.duration < edits.fadeIn.duration) warnings.push('fades-shortened');
  }
  const rate = targetRate(settings, track);
  const wanted = settings.convert.sampleRate === 'source' ? track.sampleRate : settings.convert.sampleRate;
  if (mode === 'encode' && rate !== wanted) warnings.push('rate-adjusted');

  const ctx: Context = { input, track, mode, start: range.start, length, trimmed, format, rate, warnings };

  const build = (m: Measurement | null, measuring: boolean): string[] | { error: PlanError } => {
    const d: Draft = { inputOptions: [], maps: [], filters: [], codec: [], muxer: [] };
    for (const op of OPERATIONS) {
      if (measuring && (op.id === 'convert' || op.id === 'output')) break;
      const r = op.apply(d, ctx, m);
      if (r) return r;
    }
    const head = ['-hide_banner', '-nostdin', '-y', ...d.inputOptions, '-i', input.inputPath, ...d.maps];
    const af = d.filters.length ? ['-af', d.filters.join(',')] : [];
    if (measuring) return [...head, ...af, '-f', 'null', '-'];
    return [...head, ...af, ...d.codec, ...d.muxer, input.outputPath];
  };

  const n = settings.normalize;
  const measures = mode === 'encode' && n.enabled;
  const measureKind = n.mode === 'peak' ? 'volume' : 'loudnorm';
  let measure: JobPlan['measure'] = null;
  if (measures) {
    const args = build(null, true);
    if (!Array.isArray(args)) return args;
    measure = { kind: measureKind, args };
  }

  return {
    measure,
    render: (m) => {
      if (measures && !m) return { error: 'missing-measurement' };
      return build(measures ? (m ?? null) : null, false);
    },
    extension: mode === 'encode' ? FORMAT_EXT[format] : copyTarget(track.codec).ext,
    warnings,
  };
}

const num = (s: string | undefined): number => (s === undefined ? NaN : s.trim() === '-inf' ? -Infinity : Number(s));

/** Reads the first pass's stderr. Null when ffmpeg printed nothing usable. */
export function parseMeasurement(kind: Measurement['kind'], stderr: string): Measurement | null {
  if (kind === 'volume') {
    const match = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(stderr);
    return match ? { kind, maxVolume: num(match[1]) } : null;
  }
  const at = stderr.lastIndexOf('[Parsed_loudnorm');
  const json = /\{[^{}]*\}/.exec(at >= 0 ? stderr.slice(at) : stderr);
  if (!json) return null;
  try {
    const o = JSON.parse(json[0]) as Record<string, string>;
    return {
      kind,
      i: num(o.input_i),
      tp: num(o.input_tp),
      lra: num(o.input_lra),
      thresh: num(o.input_thresh),
      offset: num(o.target_offset),
    };
  } catch {
    return null;
  }
}
