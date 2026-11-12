// The mix as one ffmpeg command: every clip is an input cut to the part its file keeps, with the
// file's fades, a gain when matching loudness, and the mix rate and layout; then a chain of
// acrossfade (concat on dry cuts) and the mix's own fades over the whole. Nothing here runs ffmpeg.

import { fittedFades, keptRange, rangeLength, type FileEdits, type Silences } from './edits.ts';
import { audioTracks, ffTime, videoTracks, type AudioTrack, type MediaInfo, type Rational, type Size } from './media.ts';
import type { Measurement, Warning } from './operations.ts';
import { PRORES_PROFILES, type Curve, type OutputSettings } from './settings.ts';
import { layout, transitionOf, type Clip, type Layout, type MixSettings, type Transition } from './timeline.ts';
import { describePicture, ffmpegPictureFilters, parseRate, type Grid, type PictureDescription } from './video.ts';

export interface MixClip {
  clip: Clip;
  info: MediaInfo;
  edits: FileEdits;
  /** The file's effective settings: they say which audio track and whether silences are cut. */
  settings: OutputSettings;
  silences?: Silences | null;
}

export type MixError = 'no-clips' | 'no-audio-track' | 'empty-range' | 'missing-measurement' | 'no-picture' | 'crop-outside-frame' | 'hap-needs-decoder';

/** Where a clip reads from its file, in seconds of the file. */
export interface Source {
  /** Null for a clip without sound in a video mix: its place is silence. */
  track: AudioTrack | null;
  start: number;
  length: number;
}

/** `silent`: a clip without an audio track is not an error but silence (a video mix). */
export function sourceOf(c: MixClip, silent = false): Source | { error: MixError } {
  const tracks = audioTracks(c.info);
  const track = tracks.find((t) => t.index === c.settings.extract.track) ?? tracks[0] ?? null;
  if (!track && !silent) return { error: 'no-audio-track' };
  const range = keptRange(c.edits, c.info.duration, c.settings.trim.silence ? c.silences : null);
  const length = rangeLength(range);
  if (length === 0) return { error: 'empty-range' };
  return { track, start: range.start, length };
}

/** Clip lengths for `layout`, from what each file keeps. */
export const lengthsOf = (clips: readonly MixClip[], silent = false): Map<string, number> =>
  new Map(clips.flatMap((c) => {
    const s = sourceOf(c, silent);
    return 'error' in s ? [] : [[c.clip.id, s.length] as [string, number]];
  }));

export const mixLayout = (clips: readonly MixClip[], mix: MixSettings): Layout => layout(clips.map((c) => c.clip), lengthsOf(clips, mix.kind === 'video'), mix);

/** Highest true peak a matched clip may reach. */
export const MATCH_CEILING = -1;

/** Linear gain towards the target loudness, held back so the true peak stays under the ceiling. */
export function matchGain(m: Measurement, target: number): number {
  if (m.kind !== 'loudnorm' || !Number.isFinite(m.i)) return 0;
  const gain = target - m.i;
  return Number.isFinite(m.tp) ? Math.min(gain, MATCH_CEILING - m.tp) : gain;
}

/** First pass of matching: the loudness of the part of the file the clip keeps. */
export function measureArgs(source: Source & { track: AudioTrack }, inputPath: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-ss', ffTime(source.start), '-t', ffTime(source.length), '-i', inputPath,
    '-map', `0:a:${source.track.index}`, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-',
  ];
}

/** What a measurement depends on, to reuse it while the clip does not change. */
export const measureKeyOf = (fileId: string, s: Source): string => `mix:${fileId}:${s.track?.index ?? 'none'}:${s.start}:${s.length}`;

/** A part of a clip: `from` and `length` in seconds of the kept range. */
interface Window {
  from: number;
  length: number;
}

const fadesFor = (edits: FileEdits, kept: number, w: Window): string[] => {
  const { fadeIn, fadeOut } = fittedFades(edits, kept);
  const out: string[] = [];
  // A window that starts inside the fade in hears what is left of it.
  if (fadeIn.duration > w.from) out.push(`afade=t=in:st=0:d=${ffTime(fadeIn.duration - w.from)}:curve=${fadeIn.curve}`);
  const outStart = kept - fadeOut.duration - w.from;
  if (fadeOut.duration > 0 && outStart < w.length) {
    const st = Math.max(0, outStart);
    out.push(`afade=t=out:st=${ffTime(st)}:d=${ffTime(fadeOut.duration + Math.min(0, outStart))}:curve=${fadeOut.curve}`);
  }
  return out;
};

interface Part {
  source: Source;
  edits: FileEdits;
  window: Window;
  gain: number;
}

interface Built {
  inputOptions: string[][];
  filter: string;
  /** What ffmpeg maps to the output, in order. */
  maps: string[];
}

/** The common frame of a video mix: every clip is brought to this size and rate. */
export interface Canvas {
  size: Size;
  fps: Rational;
}

/** A clip's picture in a video mix: how it is drawn on the canvas, or null for a clip without picture (black). */
export interface VideoPart {
  picture: PictureDescription | null;
  /** Position among the file's video tracks. */
  track: number;
  length: number;
}

const rateOf = (r: Rational): Rational => (r.num > 0 && r.den > 0 ? r : { num: 30, den: 1 });

/** The canvas of a video mix, from the first clip with picture. */
/** Sizes in the mix's video format: even, or a multiple of 4 for HAP. */
export const mixGrid = (mix: MixSettings): Grid => (mix.video.format === 'hap' ? 4 : 2);

export function canvasOf(clips: readonly MixClip[], mix: MixSettings): Canvas | { error: MixError } {
  const first = clips.map((c) => ({ c, v: videoTracks(c.info)[0] })).find((x) => x.v);
  if (!first?.v) return { error: 'no-picture' };
  const fps = mix.video.fps === 'source' ? rateOf(first.v.fps) : parseRate(mix.video.fps);
  const grid = mixGrid(mix);
  if (mix.video.canvas === 'fixed') {
    const down = (n: number) => Math.max(grid, n - (n % grid));
    return { size: { width: down(mix.video.width), height: down(mix.video.height) }, fps };
  }
  const d = describePicture(first.v, { ...first.c.settings.picture, speed: 1, scale: { mode: 'source', width: 2, height: 2 } }, null, grid);
  if ('error' in d) return d;
  return { size: d.size, fps };
}

/** A clip's picture on the canvas. Its size, rate and speed do not count: the canvas rules. */
export function videoPartOf(c: MixClip, length: number, canvas: Canvas, mix: MixSettings): VideoPart | { error: MixError } {
  const v = videoTracks(c.info)[0];
  if (!v) return { picture: null, track: 0, length };
  const { fadeIn, fadeOut } = fittedFades(c.edits, length);
  const picture = { ...c.settings.picture, speed: 1, scale: { mode: mix.video.fit, width: canvas.size.width, height: canvas.size.height } };
  const d = describePicture(v, picture, { fadeIn: fadeIn.duration, fadeOut: fadeOut.duration, length }, mixGrid(mix));
  if ('error' in d) return d;
  return { picture: { ...d, fps: canvas.fps }, track: v.index, length };
}

/** The picture chain: each clip drawn on the canvas, then xfade (concat on dry cuts), then the mix's fades to black. */
function videoChains(parts: readonly VideoPart[], lay: Layout, canvas: Canvas, tail: string[]): string[] {
  const { width, height } = canvas.size;
  const chains = parts.map((p, i) =>
    p.picture
      ? `[${i}:v:${p.track}]${[...ffmpegPictureFilters(p.picture), 'setpts=PTS-STARTPTS', 'format=yuv420p'].join(',')}[v${i}]`
      : `color=c=black:s=${width}x${height}:r=${canvas.fps.num}/${canvas.fps.den}:d=${ffTime(p.length)},setsar=1,format=yuv420p[v${i}]`,
  );
  let prev = 'v0';
  for (let i = 1; i < parts.length; i++) {
    const { overlapIn, start } = lay.placed[i]!;
    const next = `w${i}`;
    chains.push(
      overlapIn > 0
        ? `[${prev}][v${i}]xfade=transition=fade:duration=${ffTime(overlapIn)}:offset=${ffTime(start)}[${next}]`
        : `[${prev}][v${i}]concat=n=2:v=1:a=0[${next}]`,
    );
    prev = next;
  }
  chains.push(`[${prev}]${tail.length ? tail.join(',') : 'null'}[vout]`);
  return chains;
}

/** Each part an input, then the chain of transitions; `transitions[i]` goes into part i (i ≥ 1). */
function graph(parts: readonly Part[], transitions: readonly { overlap: number; t: Transition }[], rate: number, tail: string[], extra: string[] = []): Built {
  const inputOptions = parts.map((p) => ['-ss', ffTime(p.source.start + p.window.from), '-t', ffTime(p.window.length)]);
  const chains = parts.map((p, i) => {
    if (!p.source.track) return `anullsrc=r=${rate}:cl=stereo:d=${ffTime(p.window.length)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`;
    const filters = [
      ...fadesFor(p.edits, p.source.length, p.window),
      ...(p.gain !== 0 ? [`volume=${p.gain.toFixed(2)}dB`] : []),
      `aresample=${rate}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ];
    return `[${i}:a:${p.source.track.index}]${filters.join(',')}[a${i}]`;
  });
  let prev = 'a0';
  for (let i = 1; i < parts.length; i++) {
    const { overlap, t } = transitions[i]!;
    const next = `m${i}`;
    chains.push(
      overlap > 0
        ? `[${prev}][a${i}]acrossfade=d=${ffTime(overlap)}:c1=${t.curve}:c2=${t.curve}[${next}]`
        : `[${prev}][a${i}]concat=n=2:v=0:a=1[${next}]`,
    );
    prev = next;
  }
  chains.push(`[${prev}]${tail.length ? tail.join(',') : 'anull'}[out]`);
  return { inputOptions, filter: [...chains, ...extra].join(';'), maps: extra.length ? ['-map', '[vout]', '-map', '[out]'] : ['-map', '[out]'] };
}

const assemble = (b: Built, inputPaths: readonly string[], codec: string[], output: string[]): string[] => [
  '-hide_banner', '-nostdin', '-y',
  ...b.inputOptions.flatMap((o, i) => [...o, '-i', inputPaths[i]!]),
  '-filter_complex', b.filter, ...b.maps, ...codec, ...output,
];

export const MIX_EXT: Record<MixSettings['format'], string> = { wav: 'wav', mp3: 'mp3' };

const MIX_CODEC: Record<MixSettings['format'], string[]> = {
  wav: ['-c:a', 'pcm_s24le', '-f', 'wav'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3'],
};

/** A video mix is H.264 and AAC in mp4, or ProRes or HAP and PCM in mov. */
export const mixVideoExtension = (mix: MixSettings): string => (mix.video.format === 'mp4' ? 'mp4' : 'mov');

export const mixExtension = (mix: MixSettings): string => (mix.kind === 'video' ? mixVideoExtension(mix) : MIX_EXT[mix.format]);

/** Bitrate of the sound of an H.264 mix, in kilobits per second. */
export const MIX_AAC_KBPS = 256;

function videoCodec(mix: MixSettings, encoderThreads?: number): string[] {
  const v = mix.video;
  if (v.format === 'prores') {
    const pix = v.proresProfile === '4444' ? 'yuv444p10le' : 'yuv422p10le';
    return ['-c:v', 'prores_ks', '-profile:v', String(PRORES_PROFILES.indexOf(v.proresProfile)), '-pix_fmt', pix, '-c:a', 'pcm_s24le', '-fps_mode', 'cfr', '-f', 'mov'];
  }
  const threads = encoderThreads ? ['-threads', String(encoderThreads)] : [];
  return [
    '-c:v', 'libx264', '-preset', v.h264Preset, '-crf', String(v.h264Crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...threads,
    '-c:a', 'aac', '-b:a', `${MIX_AAC_KBPS}k`, '-fps_mode', 'cfr', '-movflags', '+faststart', '-f', 'mp4',
  ];
}

/** One clip of a video mix as the WebCodecs engine draws it: where it reads, where it sits, how it comes in. */
export interface MixSegment {
  /** Index of the clip's file in the request; the picture is null when the clip has none (black). */
  file: number;
  picture: PictureDescription | null;
  /** Seconds into the file where the kept range starts, and its length. */
  start: number;
  length: number;
  /** Seconds of the mix where it starts, and how much of its start crosses the previous clip. */
  at: number;
  overlapIn: number;
  curve: Curve;
}

export type MixWarning = Extract<Warning, 'mix-ignores-speed' | 'video-curve-linear'>;

export interface MixPlan {
  /** Sources by clip, in mix order, for the measuring pass; `track` is null for a clip without sound. */
  sources: Source[];
  layout: Layout;
  /** `gains` by clip id, in dB; needed when the mix matches loudness. */
  render(gains: ReadonlyMap<string, number> | null, encoderThreads?: number): string[] | { error: MixError };
  /** The sound of a video mix alone, AAC in an m4a, for the engine that draws the picture itself. */
  renderAudio(gains: ReadonlyMap<string, number> | null): string[] | { error: MixError };
  extension: string;
  /** The canvas and each clip's picture, for a video mix; null for an audio one. */
  video: { canvas: Canvas; parts: VideoPart[]; segments: MixSegment[] } | null;
  warnings: MixWarning[];
}

export function mixPlan(clips: readonly MixClip[], mix: MixSettings, inputPaths: readonly string[], outputPath: string): MixPlan | { error: MixError } {
  if (clips.length === 0) return { error: 'no-clips' };
  const isVideo = mix.kind === 'video';
  const sources: Source[] = [];
  for (const c of clips) {
    const s = sourceOf(c, isVideo);
    if ('error' in s) return s;
    sources.push(s);
  }
  const lay = mixLayout(clips, mix);
  const tail: string[] = [];
  if (mix.fadeIn.duration > 0) tail.push(`afade=t=in:st=0:d=${ffTime(Math.min(mix.fadeIn.duration, lay.duration))}:curve=${mix.fadeIn.curve}`);
  if (mix.fadeOut.duration > 0) {
    const d = Math.min(mix.fadeOut.duration, lay.duration);
    tail.push(`afade=t=out:st=${ffTime(lay.duration - d)}:d=${ffTime(d)}:curve=${mix.fadeOut.curve}`);
  }

  const warnings: MixWarning[] = [];
  let video: MixPlan['video'] = null;
  const vtail: string[] = [];
  if (isVideo) {
    const canvas = canvasOf(clips, mix);
    if ('error' in canvas) return canvas;
    const parts: VideoPart[] = [];
    for (const [i, c] of clips.entries()) {
      const p = videoPartOf(c, sources[i]!.length, canvas, mix);
      if ('error' in p) return p;
      parts.push(p);
    }
    const segments = clips.map((c, i): MixSegment => ({
      file: i,
      picture: parts[i]!.picture,
      start: sources[i]!.start,
      length: sources[i]!.length,
      at: lay.placed[i]!.start,
      overlapIn: lay.placed[i]!.overlapIn,
      curve: transitionOf(c.clip, mix).curve,
    }));
    video = { canvas, parts, segments };
    if (clips.some((c, i) => parts[i]!.picture && c.settings.picture.speed !== 1)) warnings.push('mix-ignores-speed');
    if (clips.some((c, i) => i > 0 && lay.placed[i]!.overlapIn > 0 && transitionOf(c.clip, mix).curve !== 'tri')) warnings.push('video-curve-linear');
    // The mix's fades also take the picture to black, in straight lines: the curve is the sound's.
    if (mix.fadeIn.duration > 0) vtail.push(`fade=t=in:st=0:d=${ffTime(Math.min(mix.fadeIn.duration, lay.duration))}`);
    if (mix.fadeOut.duration > 0) {
      const d = Math.min(mix.fadeOut.duration, lay.duration);
      vtail.push(`fade=t=out:st=${ffTime(lay.duration - d)}:d=${ffTime(d)}`);
    }
  }
  const soundGraph = (gains: ReadonlyMap<string, number> | null, extra: string[] = []): Built | { error: MixError } => {
    if (mix.matchLoudness && !gains) return { error: 'missing-measurement' };
    const parts = clips.map((c, i) => ({
      source: sources[i]!,
      edits: c.edits,
      window: { from: 0, length: sources[i]!.length },
      gain: mix.matchLoudness ? (gains?.get(c.clip.id) ?? 0) : 0,
    }));
    const transitions = clips.map((c, i) => ({ overlap: lay.placed[i]!.overlapIn, t: transitionOf(c.clip, mix) }));
    return graph(parts, transitions, mix.sampleRate, tail, extra);
  };
  return {
    sources,
    layout: lay,
    extension: mixExtension(mix),
    video,
    warnings,
    renderAudio(gains) {
      const built = soundGraph(gains);
      if ('error' in built) return built;
      // AAC for the mp4 the browser writes, 24-bit PCM in a WAV for the HAP mov.
      const sound = mix.video.format === 'hap' ? ['-c:a', 'pcm_s24le', '-f', 'wav'] : ['-c:a', 'aac', '-b:a', `${MIX_AAC_KBPS}k`, '-f', 'ipod'];
      return assemble(built, inputPaths, sound, [outputPath]);
    },
    render(gains, encoderThreads) {
      // No ffmpeg here makes HAP: the browser's decoder and the own encoder do.
      if (video && mix.video.format === 'hap') return { error: 'hap-needs-decoder' };
      const built = soundGraph(gains, video ? videoChains(video.parts, lay, video.canvas, vtail) : []);
      if ('error' in built) return built;
      const codec = video ? videoCodec(mix, encoderThreads) : MIX_CODEC[mix.format];
      return assemble(built, inputPaths, codec, [outputPath]);
    },
  };
}

/** Seconds heard on each side of a transition when listening to it. */
export const PREVIEW_CONTEXT = 10;

export interface PreviewPlan {
  args: string[];
  /** Where the cross starts in the preview, in seconds. */
  crossAt: number;
  duration: number;
}

/**
 * The transition into `clips[1]` from `clips[0]`, with `transition` in place of the saved one: the
 * end of the first clip and the start of the second, about 20 s, in WAV. `gains` as for the mix.
 */
export function previewPlan(
  pair: readonly [MixClip, MixClip],
  transition: Transition,
  mix: MixSettings,
  gains: ReadonlyMap<string, number> | null,
  inputPaths: readonly [string, string],
  outputPath: string,
): PreviewPlan | { error: MixError } {
  const a = sourceOf(pair[0]);
  if ('error' in a) return a;
  const b = sourceOf(pair[1]);
  if ('error' in b) return b;
  const wanted = transition.cut ? 0 : transition.duration;
  const overlap = Math.min(wanted, a.length, b.length);
  const aLen = Math.min(a.length, overlap + PREVIEW_CONTEXT);
  const bLen = Math.min(b.length, overlap + PREVIEW_CONTEXT);
  const gain = (c: MixClip) => (mix.matchLoudness ? (gains?.get(c.clip.id) ?? 0) : 0);
  const parts: Part[] = [
    { source: a, edits: pair[0].edits, window: { from: a.length - aLen, length: aLen }, gain: gain(pair[0]) },
    { source: b, edits: pair[1].edits, window: { from: 0, length: bLen }, gain: gain(pair[1]) },
  ];
  const built = graph(parts, [{ overlap: 0, t: transition }, { overlap, t: transition }], mix.sampleRate, []);
  return {
    args: assemble(built, inputPaths, ['-c:a', 'pcm_s16le', '-f', 'wav'], [outputPath]),
    crossAt: aLen - overlap,
    duration: aLen + bLen - overlap,
  };
}

/** Bytes of the mix in WAV: 24-bit stereo at the mix rate. */
export const wavBytes = (duration: number, rate: number): number => Math.ceil(duration * rate) * 2 * 3 + 44;

/** Above this the WAV mix may not fit in the engine's memory (2 GB for input reads and output). */
export const WAV_MEMORY_LIMIT = 1024 ** 3;
