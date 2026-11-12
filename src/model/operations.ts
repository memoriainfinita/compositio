// Operations are declarative: each step of «Salida» says which tracks it touches and adds its part
// to an ffmpeg command. Nothing here runs ffmpeg; the engine runs the plan. A job comes out as a
// sound file or as a video file (`extract.kind`); the picture's steps only count for the second.

import {
  audioTracks, ffTime, hasAlpha, isHdr, isVideo, LOSSY_AUDIO, videoTracks,
  type AudioTrack, type MediaInfo, type VideoTrack,
} from './media.ts';
import { fittedFades, keptRange, rangeLength, type FileEdits, type Silences } from './edits.ts';
import { describePicture, ffmpegPictureFilters, num, outputFps, type PictureDescription } from './video.ts';
import { defaultSettings, type Format, type OutputSettings, type HapVariant, type Step, type VideoFormat } from './settings.ts';

/** What «untouched» means for the picture. */
const defaultPicture = defaultSettings().picture;

export interface PlanInput {
  info: MediaInfo;
  edits: FileEdits;
  /** Effective settings: the batch with the file's own values applied. */
  settings: OutputSettings;
  silences?: Silences | null;
  inputPath: string;
  outputPath: string;
  /** The file whose sound replaces this one's (`extract.audio: 'replace'`), mounted as the second input. */
  replacement?: { path: string; info: MediaInfo };
  /** Threads for the video encoder; absent leaves it to ffmpeg. The single-thread core must not be given any. */
  encoderThreads?: number;
}

export type Measurement =
  | { kind: 'loudnorm'; i: number; tp: number; lra: number; thresh: number; offset: number }
  | { kind: 'volume'; maxVolume: number };

export type Warning =
  | 'lossy-reencode'
  | 'lossless-unavailable'
  | 'copy-ignores-processing'
  | 'rate-adjusted'
  | 'fades-shortened'
  | 'keyframe-cut'
  | 'audio-absent'
  | 'hdr-not-mapped'
  | 'size-rounded'
  | 'output-may-not-fit'
  | 'slow-video'
  | 'webcodecs-fallback'
  | 'mix-ignores-speed'
  | 'video-curve-linear';

export type PlanError =
  | 'no-audio-track'
  | 'no-video-track'
  | 'empty-range'
  | 'silent-input'
  | 'missing-measurement'
  | 'crop-outside-frame'
  | 'replace-missing'
  /** HAP is drawn by the browser's own decoder: without it, or through ffmpeg alone, it cannot be made. */
  | 'hap-needs-decoder';

/** What a video job does, without saying with which engine: the picture, the range and the encoder. */
export interface VideoJob {
  picture: PictureDescription;
  codec: 'h264' | 'prores' | 'hap';
  /** The texture of a HAP video. */
  hapVariant: HapVariant;
  crf: number;
  preset: string;
  start: number;
  length: number;
  speed: number;
  /** What the output's sound is. */
  audio: AudioOut;
  /** Whether the engine may be WebCodecs: an encode to H.264 in mp4. */
  portable: boolean;
}

export interface JobPlan {
  /** First pass, when normalizing: its stderr goes to `parseMeasurement`. */
  measure: { kind: Measurement['kind']; args: string[] } | null;
  render(measurement?: Measurement | null): string[] | { error: PlanError };
  /** The sound alone, as AAC in an m4a, for the engine that makes the picture itself. Null without sound or when the job is not portable. */
  renderAudio: (measurement?: Measurement | null) => string[] | { error: PlanError } | null;
  /** The video job, null for sound files. */
  video: VideoJob | null;
  extension: string;
  warnings: Warning[];
  /** Seconds of output, which is what ffmpeg's `time=` counts: the kept range over the speed. */
  outputDuration: number;
}

type Mode = 'encode' | 'copy-track' | 'copy-trim';
/** What the output's sound is: the file's (or the replacement's), generated silence, or none. */
export type AudioOut = 'real' | 'silence' | 'none';

export interface Context {
  input: PlanInput;
  kind: 'audio' | 'video';
  /** The track the sound comes from; a stand-in for silence and for none. */
  track: AudioTrack;
  audio: AudioOut;
  video: VideoTrack | null;
  mode: Mode;
  start: number;
  length: number;
  trimmed: boolean;
  /** Format of the sound in the output. */
  format: Format;
  rate: number;
  /** Speed of picture and sound; 1 for anything but re-encoded video. */
  speed: number;
  warnings: Warning[];
  /** Set by `build` before each pass: the measuring pass keeps to the sound. */
  measuring: boolean;
  /** Set by `build`: only the sound, to an m4a. */
  audioOnly: boolean;
}

export interface Draft {
  inputOptions: string[];
  /** Inputs after the file's own: the replacement sound, or generated silence. */
  extraInputs: string[];
  /** The measuring pass of a replaced sound reads the replacement alone. */
  skipMain: boolean;
  maps: string[];
  vfilters: string[];
  filters: string[];
  /** Output length for sounds that would never end by themselves (silence, a longer replacement). */
  limit: string[];
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

const MP4_VIDEO = new Set(['h264', 'hevc', 'av1', 'mpeg4', 'vp9']);
const MP4_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3', 'opus', 'alac']);
/** Sizes of a video in the format: even for 4:2:0, a multiple of 4 for HAP's blocks. */
export const gridOf = (format: OutputSettings['convert']['videoFormat']): 2 | 4 => (format === 'hap' ? 4 : 2);

const MOV_VIDEO = new Set(['prores', 'dnxhd', 'mjpeg', 'qtrle', 'hap']);

/** Container for streams copied as they are: mp4 for the usual, mov for the editing codecs, mkv for the rest. */
export function copyVideoTarget(video: string, audio: string | null): { ext: string; muxer: string } {
  const audioFits = (set: (c: string) => boolean) => audio === null || set(audio);
  if (MP4_VIDEO.has(video) && audioFits((a) => MP4_AUDIO.has(a))) return { ext: 'mp4', muxer: 'mp4' };
  if (MOV_VIDEO.has(video) && audioFits((a) => a.startsWith('pcm_') || a === 'aac' || a === 'alac')) return { ext: 'mov', muxer: 'mov' };
  return { ext: 'mkv', muxer: 'matroska' };
}

/** Output sample rate: the source's or the chosen one, within what the codec accepts. */
function targetRate(s: OutputSettings, track: AudioTrack, format: Format): number {
  const wanted = s.convert.sampleRate === 'source' ? track.sampleRate : s.convert.sampleRate;
  if (format === 'opus') return 48000;
  if (format === 'mp3') return Math.min(wanted, 48000);
  return wanted;
}

const channelLayout = (channels: number, known?: string): string | undefined =>
  known ?? ({ 1: 'mono', 2: 'stereo' } as Record<number, string>)[channels];

const hasFades =(e: FileEdits): boolean => e.fadeIn.duration > 0 || e.fadeOut.duration > 0;

// --- the picture ---

/** `atempo` takes 0.5 to 2 at a time; the rest goes in more stages. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let left = speed;
  while (left > 2) {
    out.push('atempo=2');
    left /= 2;
  }
  while (left < 0.5) {
    out.push('atempo=0.5');
    left *= 2;
  }
  if (Math.abs(left - 1) > 1e-9) out.push(`atempo=${num(left)}`);
  return out;
}

/** Megabits per second of ProRes at 1920x1080 and 29.97 fps, per profile (Apple's figures). */
const PRORES_MBPS: Record<OutputSettings['convert']['proresProfile'], number> = { proxy: 45, lt: 102, standard: 147, hq: 220, '4444': 330 };
const PRORES_INDEX: Record<OutputSettings['convert']['proresProfile'], number> = { proxy: 0, lt: 1, standard: 2, hq: 3, '4444': 4 };
/** ffmpeg.wasm keeps its output in memory, under about 2 GB; past this a warning says it may not fit. */
export const OUTPUT_WARN_BYTES = 1.5e9;

// --- the steps ---

const extract: Operation = {
  id: 'extract',
  tracks: ['audio', 'video'],
  apply(d, ctx) {
    if (ctx.kind === 'audio') {
      d.maps.push('-map', `0:a:${ctx.track.index}`);
      if (ctx.mode === 'copy-track') d.codec.push('-c:a', 'copy');
      return;
    }
    const { settings, replacement } = ctx.input;
    if (!ctx.measuring && !ctx.audioOnly) d.maps.push('-map', `0:v:${ctx.video!.index}`);
    if (ctx.audio === 'real') {
      if (settings.extract.audio === 'replace') {
        const rep = replacement!;
        // Measuring a replaced sound reads the replacement alone, so it is its first and only input.
        if (ctx.measuring) d.skipMain = true;
        d.extraInputs.push('-i', rep.path);
        d.maps.push('-map', `${ctx.measuring ? 0 : 1}:a:${ctx.track.index}`);
        d.limit.push('-t', ffTime(ctx.length / ctx.speed));
      } else {
        d.maps.push('-map', `0:a:${ctx.track.index}`);
      }
    } else if (ctx.audio === 'silence' && !ctx.measuring) {
      const layout = channelLayout(ctx.track.channels, ctx.track.channelLayout) ?? 'stereo';
      d.extraInputs.push('-f', 'lavfi', '-i', `anullsrc=r=${ctx.rate}:cl=${layout}`);
      d.maps.push('-map', '1:a:0');
      d.limit.push('-t', ffTime(ctx.length / ctx.speed));
    }
    if (ctx.mode === 'copy-track') d.codec.push('-c:v', 'copy');
    if (ctx.mode === 'copy-track' && ctx.audio === 'real' && settings.extract.audio === 'keep') d.codec.push('-c:a', 'copy');
  },
};

const trim: Operation = {
  id: 'trim',
  tracks: ['audio', 'video'],
  apply(d, ctx) {
    if (ctx.trimmed && !d.skipMain) d.inputOptions.push('-ss', ffTime(ctx.start), '-t', ffTime(ctx.length));
    if (ctx.mode !== 'encode' || ctx.audio !== 'real') return;
    const { fadeIn, fadeOut } = fittedFades(ctx.input.edits, ctx.length);
    if (fadeIn.duration > 0) d.filters.push(`afade=t=in:st=0:d=${ffTime(fadeIn.duration)}:curve=${fadeIn.curve}`);
    if (fadeOut.duration > 0) {
      const st = ffTime(ctx.length - fadeOut.duration);
      d.filters.push(`afade=t=out:st=${st}:d=${ffTime(fadeOut.duration)}:curve=${fadeOut.curve}`);
    }
  },
};

const picture: Operation = {
  id: 'picture',
  tracks: ['video'],
  apply(d, ctx) {
    if (ctx.kind !== 'video' || ctx.mode !== 'encode') return;
    // The sound follows the speed before it is measured or normalized, as it will in the render.
    if (ctx.audio === 'real') d.filters.push(...atempoChain(ctx.speed));
    if (ctx.measuring || ctx.audioOnly) return;
    const { edits, settings } = ctx.input;
    const { fadeIn, fadeOut } = fittedFades(edits, ctx.length);
    const r = describePicture(ctx.video!, settings.picture, { fadeIn: fadeIn.duration, fadeOut: fadeOut.duration, length: ctx.length }, gridOf(settings.convert.videoFormat));
    if ('error' in r) return { error: r.error };
    d.vfilters.push(...ffmpegPictureFilters(r));
  },
};

const normalize: Operation = {
  id: 'normalize',
  tracks: ['audio'],
  apply(d, ctx, m) {
    const n = ctx.input.settings.normalize;
    if (ctx.mode !== 'encode' || !n.enabled || ctx.audio !== 'real') return;
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

/** Codec arguments of the picture for a re-encoded video file. */
function videoCodec(ctx: Context): string[] {
  const c = ctx.input.settings.convert;
  const threads = ctx.input.encoderThreads ? ['-threads', String(ctx.input.encoderThreads)] : [];
  const cfr = ['-fps_mode', 'cfr'];
  if (c.videoFormat === 'prores') {
    const alpha = c.proresProfile === '4444' && hasAlpha(ctx.video!);
    const pix = c.proresProfile === '4444' ? (alpha ? 'yuva444p10le' : 'yuv444p10le') : 'yuv422p10le';
    return ['-c:v', 'prores_ks', '-profile:v', String(PRORES_INDEX[c.proresProfile]), '-pix_fmt', pix, ...cfr];
  }
  return ['-c:v', 'libx264', '-preset', c.h264Preset, '-crf', String(c.h264Crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...threads, ...cfr];
}

const convert: Operation = {
  id: 'convert',
  tracks: ['audio', 'video'],
  apply(d, ctx) {
    if (ctx.mode === 'copy-trim') d.codec.push('-c:a', 'copy');
    if (ctx.mode !== 'encode') {
      // Copying a video file with a sound that is not the file's own: the sound is encoded, the picture is copied.
      if (ctx.kind === 'video' && ctx.mode === 'copy-track' && ctx.audio !== 'none' && ctx.input.settings.extract.audio !== 'keep') {
        d.codec.push('-c:a', 'aac', '-b:a', `${ctx.input.settings.convert.aacBitrate}k`);
      }
      return;
    }
    if (ctx.kind === 'video' && !ctx.audioOnly) d.codec.push(...videoCodec(ctx));
    if (ctx.audio === 'none') return void d.codec.push('-an');
    const c = ctx.input.settings.convert;
    const deep = ctx.format === 'wav' || ctx.format === 'flac' ? c.bitDepth : null;
    // Lossy sources decode to float, so they count as deeper than 16 bits.
    const dither = deep === 16 && c.dither && (ctx.track.bitDepth ?? 32) > 16;
    // loudnorm works at 192 kHz, so after it the rate is always set back.
    const resample = ctx.rate !== ctx.track.sampleRate || (ctx.input.settings.normalize.enabled && ctx.audio === 'real') || dither;
    if (resample && ctx.audio === 'real') d.filters.push(`aresample=${ctx.rate}${dither ? ':osf=s16:dither_method=triangular' : ''}`);
    // ffmpeg 5.1 (ffmpeg.wasm) cannot negotiate the channel layout after loudnorm; it is set here.
    const n = ctx.input.settings.normalize;
    const layout = channelLayout(c.channels === 'source' ? ctx.track.channels : c.channels, c.channels === 'source' ? ctx.track.channelLayout : undefined);
    if (n.enabled && n.mode === 'lufs' && layout && ctx.audio === 'real') d.filters.push(`aformat=channel_layouts=${layout}`);
    if (c.channels !== 'source') d.codec.push('-ac', String(c.channels));
    switch (ctx.format) {
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
    if (ctx.kind === 'video' && ctx.audioOnly) {
      // The sound for the picture the browser draws itself: AAC for an mp4, PCM for a HAP mov.
      d.muxer.push('-map_metadata', settings.convert.keepMetadata ? '0' : '-1', '-f', settings.convert.videoFormat === 'mp4' ? 'ipod' : 'wav');
      return;
    }
    if (ctx.kind === 'video') {
      d.muxer.push('-map_metadata', settings.convert.keepMetadata ? '0' : '-1');
      const target = ctx.mode === 'encode' ? { muxer: settings.convert.videoFormat === 'prores' ? 'mov' : 'mp4' } : copyVideoTarget(ctx.video!.codec, ctx.audio === 'real' && settings.extract.audio === 'keep' ? ctx.track.codec : ctx.audio === 'none' ? null : 'aac');
      if (target.muxer === 'mp4') d.muxer.push('-movflags', '+faststart');
      d.muxer.push('-f', target.muxer);
      return;
    }
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
export const OPERATIONS: readonly Operation[] = [extract, trim, picture, normalize, convert, output];

function chooseMode(input: PlanInput, kind: 'audio' | 'video', track: AudioTrack, warnings: Warning[]): Mode {
  const s = input.settings;
  const pictureTouched = JSON.stringify(s.picture) !== JSON.stringify(defaultPicture);
  if (s.extract.mode === 'copy') {
    if (hasFades(input.edits) || s.normalize.enabled || (kind === 'video' && pictureTouched)) warnings.push('copy-ignores-processing');
    return 'copy-track';
  }
  if (kind === 'video' || !s.trim.lossless) return 'encode';
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

/** A stand-in for the sound of silence and of no sound: nothing reads its codec. */
const standIn = (rate: number, channels: number): AudioTrack => ({
  kind: 'audio',
  index: 0,
  codec: 'pcm_f32le',
  channels,
  ...(channelLayout(channels) ? { channelLayout: channelLayout(channels)! } : {}),
  sampleRate: rate,
});

export function plan(input: PlanInput): JobPlan | { error: PlanError } {
  const { info, edits, settings } = input;
  const kind = settings.extract.kind;
  const audios = audioTracks(info);
  const video = kind === 'video' ? (videoTracks(info)[0] ?? null) : null;
  if (kind === 'video' && !video) return { error: 'no-video-track' };

  const warnings: Warning[] = [];
  let audio: AudioOut = 'real';
  let track: AudioTrack;
  if (kind === 'audio') {
    const t = audios.find((x) => x.index === settings.extract.track) ?? audios[0];
    if (!t) return { error: 'no-audio-track' };
    track = t;
  } else if (settings.extract.audio === 'replace') {
    const rep = input.replacement;
    const wanted = settings.extract.replaceWith?.track ?? 0;
    const t = rep ? audioTracks(rep.info).find((x) => x.index === wanted) : undefined;
    if (!rep || !t) return { error: 'replace-missing' };
    track = t;
  } else if (settings.extract.audio === 'keep') {
    const t = audios.find((x) => x.index === settings.extract.track) ?? audios[0];
    if (t) track = t;
    else {
      audio = 'none';
      track = standIn(48000, 2);
      warnings.push('audio-absent');
    }
  } else {
    audio = settings.extract.audio === 'silence' ? 'silence' : 'none';
    track = standIn(settings.convert.sampleRate === 'source' ? 48000 : settings.convert.sampleRate, settings.convert.channels === 1 ? 1 : 2);
  }

  const range = keptRange(edits, info.duration, settings.trim.silence ? input.silences : null);
  const length = rangeLength(range);
  if (length === 0) return { error: 'empty-range' };
  const trimmed = range.start > 0 || range.end < info.duration;

  const mode = chooseMode(input, kind, track, warnings);
  const format: Format = kind === 'video' ? (settings.convert.videoFormat === 'mp4' ? 'aac' : 'wav') : settings.convert.format;
  if (mode === 'encode' && audio === 'real') {
    if (LOSSY_AUDIO.has(track.codec) && LOSSY_AUDIO.has(FORMAT_CODEC[format])) warnings.push('lossy-reencode');
    if (fittedFades(edits, length).fadeIn.duration < edits.fadeIn.duration) warnings.push('fades-shortened');
  }
  const rate = targetRate(settings, track, format);
  const wanted = settings.convert.sampleRate === 'source' ? track.sampleRate : settings.convert.sampleRate;
  if (mode === 'encode' && audio !== 'none' && rate !== wanted) warnings.push('rate-adjusted');

  const speed = kind === 'video' && mode === 'encode' ? settings.picture.speed : 1;
  const outputDuration = length / speed;
  if (kind === 'video' && mode !== 'encode' && trimmed) warnings.push('keyframe-cut');
  if (kind === 'video' && video && isHdr(video)) warnings.push('hdr-not-mapped');

  const ctx: Context = { input, kind, track, audio, video, mode, start: range.start, length, trimmed, format, rate, speed, warnings, measuring: false, audioOnly: false };

  // The picture is planned once to learn its warnings and its size; the render plans it again.
  let videoJob: VideoJob | null = null;
  if (kind === 'video' && mode === 'encode' && video) {
    const f = fittedFades(edits, length);
    const r = describePicture(video, settings.picture, { fadeIn: f.fadeIn.duration, fadeOut: f.fadeOut.duration, length }, gridOf(settings.convert.videoFormat));
    if ('error' in r) return r;
    if (r.rounded) warnings.push('size-rounded');
    if (settings.convert.videoFormat === 'prores') {
      const mbps = PRORES_MBPS[settings.convert.proresProfile] * ((r.size.width * r.size.height * outputFps(r)) / (1920 * 1080 * 29.97));
      if ((mbps * 1e6 * outputDuration) / 8 > OUTPUT_WARN_BYTES) warnings.push('output-may-not-fit');
    }
    videoJob = {
      picture: r,
      codec: settings.convert.videoFormat === 'prores' ? 'prores' : settings.convert.videoFormat === 'hap' ? 'hap' : 'h264',
      hapVariant: settings.convert.hapVariant,
      crf: settings.convert.h264Crf,
      preset: settings.convert.h264Preset,
      start: range.start,
      length,
      speed,
      audio,
      portable: settings.convert.videoFormat === 'mp4',
    };
  }

  const build = (m: Measurement | null, measuring: boolean, audioOnly = false): string[] | { error: PlanError } => {
    ctx.measuring = measuring;
    ctx.audioOnly = audioOnly;
    const d: Draft = { inputOptions: [], extraInputs: [], skipMain: false, maps: [], vfilters: [], filters: [], limit: [], codec: [], muxer: [] };
    for (const op of OPERATIONS) {
      if (measuring && (op.id === 'convert' || op.id === 'output')) break;
      const r = op.apply(d, ctx, m);
      if (r) return r;
    }
    const inputs = [...(d.skipMain ? [] : [...d.inputOptions, '-i', input.inputPath]), ...d.extraInputs];
    const head = ['-hide_banner', '-nostdin', '-y', ...inputs, ...d.maps];
    const vf = d.vfilters.length ? ['-vf', d.vfilters.join(',')] : [];
    const af = d.filters.length ? ['-af', d.filters.join(',')] : [];
    if (measuring) return [...head, ...af, ...d.limit, '-f', 'null', '-'];
    if (audioOnly) return [...head, ...af, ...d.limit, ...d.codec, ...d.muxer, input.outputPath];
    return [...head, ...vf, ...af, ...d.limit, ...d.codec, ...d.muxer, input.outputPath];
  };

  const n = settings.normalize;
  const measures = mode === 'encode' && n.enabled && audio === 'real';
  const measureKind = n.mode === 'peak' ? 'volume' : 'loudnorm';
  let measure: JobPlan['measure'] = null;
  if (measures) {
    const args = build(null, true);
    if (!Array.isArray(args)) return args;
    measure = { kind: measureKind, args };
  }

  const extension =
    kind === 'video'
      ? mode === 'encode'
        ? settings.convert.videoFormat === 'mp4'
          ? 'mp4'
          : 'mov'
        : copyVideoTarget(video!.codec, audio === 'real' && settings.extract.audio === 'keep' ? track.codec : audio === 'none' ? null : 'aac').ext
      : mode === 'encode'
        ? FORMAT_EXT[format]
        : copyTarget(track.codec).ext;

  return {
    measure,
    render: (m) => {
      if (videoJob?.codec === 'hap') return { error: 'hap-needs-decoder' };
      if (measures && !m) return { error: 'missing-measurement' };
      return build(measures ? (m ?? null) : null, false);
    },
    extension,
    warnings,
    outputDuration,
    video: videoJob,
    renderAudio: (m) => {
      if (!(videoJob?.portable || videoJob?.codec === 'hap') || audio === 'none') return null;
      if (measures && !m) return { error: 'missing-measurement' };
      return build(measures ? (m ?? null) : null, false, true);
    },
  };
}

const parseNum = (s: string | undefined): number => (s === undefined ? NaN : s.trim() === '-inf' ? -Infinity : Number(s));

/** Reads the first pass's stderr. Null when ffmpeg printed nothing usable. */
export function parseMeasurement(kind: Measurement['kind'], stderr: string): Measurement | null {
  if (kind === 'volume') {
    const match = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(stderr);
    return match ? { kind, maxVolume: parseNum(match[1]) } : null;
  }
  const at = stderr.lastIndexOf('[Parsed_loudnorm');
  const json = /\{[^{}]*\}/.exec(at >= 0 ? stderr.slice(at) : stderr);
  if (!json) return null;
  try {
    const o = JSON.parse(json[0]) as Record<string, string>;
    return {
      kind,
      i: parseNum(o.input_i),
      tp: parseNum(o.input_tp),
      lra: parseNum(o.input_lra),
      thresh: parseNum(o.input_thresh),
      offset: parseNum(o.target_offset),
    };
  } catch {
    return null;
  }
}

export type { VideoFormat };

export interface FrameInput {
  video: VideoTrack;
  inputPath: string;
  outputPath: string;
  /** Seconds into the file. */
  time: number;
  format: 'png' | 'jpeg';
  /** With it, the frame has the crop and size of these picture settings; without, it is the file's own picture, oriented. */
  picture?: OutputSettings['picture'];
}

/** One frame as an image, for the interface to show the picture. Shares the picture's filters with the render. */
export function frameArgs(f: FrameInput): string[] | { error: PlanError } {
  let filters: string[] = [];
  if (f.picture) {
    const r = describePicture(f.video, { ...f.picture, speed: 1, fps: 'source', fadeToBlack: false }, null);
    if ('error' in r) return r;
    filters = ffmpegPictureFilters(r).filter((x) => !x.startsWith('fps='));
  }
  return [
    '-hide_banner', '-nostdin', '-y',
    '-ss', ffTime(f.time), '-i', f.inputPath,
    '-map', `0:v:${f.video.index}`, '-frames:v', '1',
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    ...(f.format === 'jpeg' ? ['-q:v', '3'] : []),
    '-f', 'image2', '-update', '1', f.outputPath,
  ];
}
