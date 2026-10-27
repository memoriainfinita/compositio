// The mix as one ffmpeg command: every clip is an input cut to the part its file keeps, with the
// file's fades, a gain when matching loudness, and the mix rate and layout; then a chain of
// acrossfade (concat on dry cuts) and the mix's own fades over the whole. Nothing here runs ffmpeg.

import { fittedFades, keptRange, rangeLength, type FileEdits, type Silences } from './edits.ts';
import { audioTracks, ffTime, type AudioTrack, type MediaInfo } from './media.ts';
import type { Measurement } from './operations.ts';
import type { OutputSettings } from './settings.ts';
import { layout, transitionOf, type Clip, type Layout, type MixSettings, type Transition } from './timeline.ts';

export interface MixClip {
  clip: Clip;
  info: MediaInfo;
  edits: FileEdits;
  /** The file's effective settings: they say which audio track and whether silences are cut. */
  settings: OutputSettings;
  silences?: Silences | null;
}

export type MixError = 'no-clips' | 'no-audio-track' | 'empty-range' | 'missing-measurement';

/** Where a clip reads from its file, in seconds of the file. */
export interface Source {
  track: AudioTrack;
  start: number;
  length: number;
}

export function sourceOf(c: MixClip): Source | { error: MixError } {
  const tracks = audioTracks(c.info);
  const track = tracks.find((t) => t.index === c.settings.extract.track) ?? tracks[0];
  if (!track) return { error: 'no-audio-track' };
  const range = keptRange(c.edits, c.info.duration, c.settings.trim.silence ? c.silences : null);
  const length = rangeLength(range);
  if (length === 0) return { error: 'empty-range' };
  return { track, start: range.start, length };
}

/** Clip lengths for `layout`, from what each file keeps. */
export const lengthsOf = (clips: readonly MixClip[]): Map<string, number> =>
  new Map(clips.flatMap((c) => {
    const s = sourceOf(c);
    return 'error' in s ? [] : [[c.clip.id, s.length] as [string, number]];
  }));

export const mixLayout = (clips: readonly MixClip[], mix: MixSettings): Layout => layout(clips.map((c) => c.clip), lengthsOf(clips), mix);

/** Highest true peak a matched clip may reach. */
export const MATCH_CEILING = -1;

/** Linear gain towards the target loudness, held back so the true peak stays under the ceiling. */
export function matchGain(m: Measurement, target: number): number {
  if (m.kind !== 'loudnorm' || !Number.isFinite(m.i)) return 0;
  const gain = target - m.i;
  return Number.isFinite(m.tp) ? Math.min(gain, MATCH_CEILING - m.tp) : gain;
}

/** First pass of matching: the loudness of the part of the file the clip keeps. */
export function measureArgs(source: Source, inputPath: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-ss', ffTime(source.start), '-t', ffTime(source.length), '-i', inputPath,
    '-map', `0:a:${source.track.index}`, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-',
  ];
}

/** What a measurement depends on, to reuse it while the clip does not change. */
export const measureKeyOf = (fileId: string, s: Source): string => `mix:${fileId}:${s.track.index}:${s.start}:${s.length}`;

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
}

/** Each part an input, then the chain of transitions; `transitions[i]` goes into part i (i ≥ 1). */
function graph(parts: readonly Part[], transitions: readonly { overlap: number; t: Transition }[], rate: number, tail: string[]): Built {
  const inputOptions = parts.map((p) => ['-ss', ffTime(p.source.start + p.window.from), '-t', ffTime(p.window.length)]);
  const chains = parts.map((p, i) => {
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
  return { inputOptions, filter: chains.join(';') };
}

const assemble = (b: Built, inputPaths: readonly string[], codec: string[], output: string[]): string[] => [
  '-hide_banner', '-nostdin', '-y',
  ...b.inputOptions.flatMap((o, i) => [...o, '-i', inputPaths[i]!]),
  '-filter_complex', b.filter, '-map', '[out]', ...codec, ...output,
];

export const MIX_EXT: Record<MixSettings['format'], string> = { wav: 'wav', mp3: 'mp3' };

const MIX_CODEC: Record<MixSettings['format'], string[]> = {
  wav: ['-c:a', 'pcm_s24le', '-f', 'wav'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3'],
};

export interface MixPlan {
  /** Sources by clip, in mix order, for the measuring pass. */
  sources: Source[];
  layout: Layout;
  /** `gains` by clip id, in dB; needed when the mix matches loudness. */
  render(gains: ReadonlyMap<string, number> | null): string[] | { error: MixError };
  extension: string;
}

export function mixPlan(clips: readonly MixClip[], mix: MixSettings, inputPaths: readonly string[], outputPath: string): MixPlan | { error: MixError } {
  if (clips.length === 0) return { error: 'no-clips' };
  const sources: Source[] = [];
  for (const c of clips) {
    const s = sourceOf(c);
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
  return {
    sources,
    layout: lay,
    extension: MIX_EXT[mix.format],
    render(gains) {
      if (mix.matchLoudness && !gains) return { error: 'missing-measurement' };
      const parts = clips.map((c, i) => ({
        source: sources[i]!,
        edits: c.edits,
        window: { from: 0, length: sources[i]!.length },
        gain: mix.matchLoudness ? (gains?.get(c.clip.id) ?? 0) : 0,
      }));
      const transitions = clips.map((c, i) => ({ overlap: lay.placed[i]!.overlapIn, t: transitionOf(c.clip, mix) }));
      return assemble(graph(parts, transitions, mix.sampleRate, tail), inputPaths, MIX_CODEC[mix.format], [outputPath]);
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
