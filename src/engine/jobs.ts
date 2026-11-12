// Jobs on top of a Runner: read what a file contains, find its silences, process it with a plan
// from the model. WebCodecs, for video, would implement jobs like these without a Runner.

import type { Silences } from '../model/edits.ts';
import { keptRange, rangeLength } from '../model/edits.ts';
import type { MediaInfo, VideoTrack } from '../model/media.ts';
import type { OutputSettings } from '../model/settings.ts';
import { matchGain, measureArgs, measureKeyOf, mixPlan, previewPlan, sourceOf, type MixClip, type MixError, type MixPlan, type Source } from '../model/mix.ts';
import { outputFps } from '../model/video.ts';
import { frameArgs, parseMeasurement, plan, type JobPlan, type Measurement, type PlanError, type PlanInput, type Warning } from '../model/operations.ts';
import type { MixSettings, Transition } from '../model/timeline.ts';
import { parseSilences, PROBE_ARGS, silenceFilter, toMediaInfo, type ProbeJson } from './probe.ts';
import { poolSize } from './hap/pool.ts';
import { chooseBackend, estimateMixRatio, estimateRatio, SLOW_RATIO, type Backend, type VideoEngine } from './webcodecs/backend.ts';
import { h264Bitrate } from './webcodecs/bitrate.ts';
import { bitrateFor, detectCapabilities, detectMixCapabilities } from './webcodecs/capabilities.ts';
import { runMixWebCodecs, runWebCodecs } from './webcodecs/run.ts';
import { EngineError, failure, inputPath, outputPath, parseTime, type RunOptions, type Runner } from './runner.ts';

export async function probeFile(runner: Runner, file: File, options?: RunOptions): Promise<MediaInfo> {
  const out = 'probe.json';
  const r = await runner.run(
    { tool: 'ffprobe', inputs: [file], args: [...PROBE_ARGS, inputPath(0, file), '-o', outputPath(out)], outputs: [out] },
    options,
  );
  // ffprobe in ffmpeg.wasm exits with -1 even on success: its JSON is the only verdict.
  const blob = r.files.get(out);
  const json = blob ? await blob.text() : '';
  let info: MediaInfo;
  try {
    const parsed = JSON.parse(json) as ProbeJson;
    if (!parsed.format && !parsed.streams?.length) throw new Error('empty probe');
    info = toMediaInfo(parsed);
  } catch {
    throw failure([...r.log, json]);
  }
  // Recordings from browsers (MediaRecorder) and some phones carry no duration: decoding tells it.
  if (info.duration > 0 || info.tracks.length === 0) return info;
  const d = await runner.run({ inputs: [file], args: ['-hide_banner', '-nostdin', '-i', inputPath(0, file), '-map', '0', '-f', 'null', '-'], outputs: [] }, options);
  const times = d.log.map(parseTime).filter((t): t is number => t !== null);
  return times.length ? { ...info, duration: Math.max(...times) } : info;
}

export async function detectSilences(runner: Runner, file: File, info: MediaInfo, track = 0, options?: RunOptions): Promise<Silences> {
  const args = ['-hide_banner', '-nostdin', '-i', inputPath(0, file), '-map', `0:a:${track}`, '-af', silenceFilter(), '-f', 'null', '-'];
  const r = await runner.run({ inputs: [file], args, outputs: [], duration: info.duration }, options);
  if (r.code !== 0) throw failure(r.log);
  return parseSilences(r.log, info.duration);
}

export interface Processed {
  blob: Blob;
  extension: string;
  warnings: Warning[];
  measurement: Measurement | null;
  /** Frees what the result keeps outside memory (the WebCodecs engine's file in OPFS). */
  release?: () => Promise<void>;
}

/** What a job needs besides the file: the model's input, with the replacement sound as a file. */
export type FileJob = Omit<PlanInput, 'inputPath' | 'outputPath' | 'replacement'> & {
  replacement?: { file: File; info: MediaInfo };
  /** Which engine makes a video; the app's setting. */
  videoEngine?: VideoEngine;
};

/** The files a plan reads, in the order of its inputs: the file itself, then the replacement sound. */
const filesOf = (file: File, input: FileJob): File[] => (input.replacement ? [file, input.replacement.file] : [file]);

function planOf(file: File, input: FileJob, out: string): JobPlan {
  const { replacement, ...rest } = input;
  const p = plan({
    ...rest,
    ...(replacement ? { replacement: { path: inputPath(1, replacement.file), info: replacement.info } } : {}),
    inputPath: inputPath(0, file),
    outputPath: outputPath(out),
  });
  if ('error' in p) throw new EngineError('invalid-input', (p as { error: PlanError }).error);
  return p;
}

/** The multithread core only for the video encoder, and only when it was given threads. */
const coreOf = (input: FileJob): 'st' | 'mt' => (input.encoderThreads ? 'mt' : 'st');

/** The measuring pass decodes only; it weighs less in the progress than the render. */
const MEASURE_SHARE = 0.3;

export async function processFile(
  runner: Runner,
  file: File,
  input: FileJob,
  { signal, onProgress }: RunOptions = {},
): Promise<Processed> {
  const out = 'result';
  const p = planOf(file, input, out);
  const inputs = filesOf(file, input);
  const core = coreOf(input);
  // The render's progress counts output seconds; the measuring pass, kept seconds.
  const duration = p.outputDuration;
  const measureDuration = rangeLength(keptRange(input.edits, input.info.duration, input.settings.trim.silence ? input.silences : null));

  let measurement: Measurement | null = null;
  let share = 0;
  if (p.measure) {
    share = MEASURE_SHARE;
    const r = await runner.run(
      { inputs, args: p.measure.args, outputs: [], duration: measureDuration },
      { signal, onProgress: (x) => onProgress?.(x * share) },
    );
    if (r.code !== 0) throw failure(r.log);
    measurement = parseMeasurement(p.measure.kind, r.log.join('\n'));
    if (!measurement) throw new EngineError('unexpected-output', r.log.slice(-12).join('\n'));
  }

  const warnings = [...p.warnings];
  if (p.video?.portable || p.video?.codec === 'hap') {
    const setting = input.videoEngine ?? 'auto';
    const choice = chooseBackend(p.video, await detectCapabilities(p.video, file), setting);
    if (choice.backend === null) throw new EngineError('invalid-input', choice.reason);
    if (choice.backend === 'webcodecs' || choice.backend === 'hap') {
      try {
        const done = await viaWebCodecs(runner, file, input, p, measurement, share, { signal, onProgress });
        onProgress?.(1);
        return { blob: done.file, extension: p.extension, warnings, measurement, release: done.release };
      } catch (e) {
        // A forced engine says what went wrong, and HAP has no other way; the automatic one tries ffmpeg once.
        if (setting === 'webcodecs' || choice.backend === 'hap' || (e as EngineError).code === 'cancelled') throw e;
        warnings.push('webcodecs-fallback');
      }
    }
  }

  const args = p.render(measurement);
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run(
    { inputs, args, outputs: [out], duration, core },
    { signal, onProgress: (x) => onProgress?.(share + x * (1 - share)) },
  );
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  onProgress?.(1);
  return { blob, extension: p.extension, warnings, measurement };
}

/** The sound by ffmpeg, the picture by WebCodecs, joined into one mp4 in OPFS. */
async function viaWebCodecs(
  runner: Runner,
  file: File,
  input: FileJob,
  p: JobPlan,
  measurement: Measurement | null,
  share: number,
  { signal, onProgress }: RunOptions,
): Promise<{ file: File; release: () => Promise<void> }> {
  const job = p.video!;
  const inputs = filesOf(file, input);
  const soundShare = 0.1;
  let audio: File | null = null;
  const args = p.renderAudio(measurement);
  if (args && !Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  if (args) {
    const r = await runner.run(
      { inputs, args, outputs: ['result'], duration: p.outputDuration },
      { signal, onProgress: (x) => onProgress?.(share + x * soundShare) },
    );
    const blob = r.files.get('result');
    if (r.code !== 0 || !blob) throw failure(r.log);
    audio = job.codec === 'hap' ? new File([blob], 'sound.wav', { type: 'audio/wav' }) : new File([blob], 'sound.m4a', { type: 'audio/mp4' });
  }
  const from = share + (args ? soundShare : 0);
  return runWebCodecs(file, audio, job, bitrateFor(job), { signal, onProgress: (x) => onProgress?.(from + x * (1 - from)) });
}

/** Only the first pass of a plan: what normalizing needs to know, for the editor's B. */
export async function measureFile(
  runner: Runner,
  file: File,
  input: FileJob,
  options?: RunOptions,
): Promise<Measurement | null> {
  const p = planOf(file, input, 'result');
  if (!p.measure) return null;
  const inputs = filesOf(file, input);
  const duration = rangeLength(keptRange(input.edits, input.info.duration, input.settings.trim.silence ? input.silences : null));
  const r = await runner.run({ inputs, args: p.measure.args, outputs: [], duration }, options);
  if (r.code !== 0) throw failure(r.log);
  const measurement = parseMeasurement(p.measure.kind, r.log.join('\n'));
  if (!measurement) throw new EngineError('unexpected-output', r.log.slice(-12).join('\n'));
  return measurement;
}

export interface MixInput {
  clips: readonly MixClip[];
  /** The File of each clip, in the same order. */
  files: readonly File[];
  mix: MixSettings;
  /** Loudness already measured, by `measureKeyOf`; new measurements are added to it. */
  measured: Map<string, Measurement>;
  /** Which engine makes a video mix; the app's setting. */
  videoEngine?: VideoEngine;
  /** Threads for the x264 encoder of ffmpeg's multithread core. */
  encoderThreads?: number;
}

/** Measures what matching needs and has not been measured yet; returns the gain of each clip. */
async function gainsFor(
  runner: Runner,
  input: MixInput,
  sources: readonly Source[],
  { signal, onProgress }: RunOptions,
): Promise<Map<string, number>> {
  const gains = new Map<string, number>();
  for (const [i, c] of input.clips.entries()) {
    const source = sources[i]!;
    // A clip without sound has nothing to measure.
    if (!source.track) {
      gains.set(c.clip.id, 0);
      continue;
    }
    const key = measureKeyOf(c.clip.fileId, source);
    let m = input.measured.get(key);
    if (!m) {
      const file = input.files[i]!;
      const r = await runner.run({ inputs: [file], args: measureArgs({ ...source, track: source.track }, inputPath(0, file)), outputs: [], duration: source.length }, { signal });
      if (r.code !== 0) throw failure(r.log);
      const parsed = parseMeasurement('loudnorm', r.log.join('\n'));
      if (!parsed) throw new EngineError('unexpected-output', r.log.slice(-12).join('\n'));
      m = parsed;
      input.measured.set(key, m);
    }
    gains.set(c.clip.id, matchGain(m, input.mix.matchLufs));
    onProgress?.((i + 1) / input.clips.length);
  }
  return gains;
}

/** Only the measuring pass of matching, so the mix can be heard at the levels it will have. */
export async function measureMix(runner: Runner, input: MixInput, options: RunOptions = {}): Promise<Map<string, number>> {
  const sources = input.clips.map((c) => sourceOf(c, input.mix.kind === 'video'));
  const bad = sources.find((s): s is { error: MixError } => 'error' in s);
  if (bad) throw new EngineError('invalid-input', bad.error);
  return gainsFor(runner, input, sources as Source[], options);
}

/** Where a video mix is made: WebCodecs when the browser can draw and encode it, ffmpeg otherwise. */
async function mixBackend(input: MixInput, p: MixPlan): Promise<ReturnType<typeof chooseBackend>> {
  if (!p.video) return { backend: 'ffmpeg' };
  const withPicture = input.files.filter((_, i) => p.video!.parts[i]!.picture);
  const { canvas } = p.video;
  const hap = input.mix.video.format === 'hap';
  const caps = await detectMixCapabilities(canvas.size, outputFps(canvas), input.mix.video.h264Crf, withPicture, !hap);
  return chooseBackend({ portable: input.mix.video.format === 'mp4', codec: hap ? 'hap' : input.mix.video.format === 'prores' ? 'prores' : 'h264' }, caps, input.videoEngine ?? 'auto');
}

/** What making this mix would use and how long it would take, before anything runs. Null for a sound mix. */
export async function assessMix(input: MixInput): Promise<Assessment | null> {
  if (input.mix.kind !== 'video') return null;
  const p = mixPlan(input.clips, input.mix, input.files.map((f, i) => inputPath(i, f)), outputPath('mix'));
  if ('error' in p || !p.video) return null;
  const choice = await mixBackend(input, p);
  const { canvas } = p.video;
  const ratio = estimateMixRatio(canvas.size, outputFps(canvas), choice.backend ?? 'ffmpeg', input.mix.video.hapVariant, poolSize());
  return { backend: choice.backend, ratio, slow: ratio >= SLOW_RATIO };
}

export async function mixFiles(runner: Runner, input: MixInput, { signal, onProgress }: RunOptions = {}): Promise<Processed> {
  const out = 'mix';
  const p = mixPlan(input.clips, input.mix, input.files.map((f, i) => inputPath(i, f)), outputPath(out));
  if ('error' in p) throw new EngineError('invalid-input', p.error);
  const share = input.mix.matchLoudness ? MEASURE_SHARE : 0;
  const gains = input.mix.matchLoudness ? await gainsFor(runner, input, p.sources, { signal, onProgress: (x) => onProgress?.(x * share) }) : null;

  const warnings: Warning[] = [...p.warnings];
  if (p.video) {
    const setting = input.videoEngine ?? 'auto';
    const choice = await mixBackend(input, p);
    if (choice.backend === null) throw new EngineError('invalid-input', choice.reason);
    if (choice.backend === 'webcodecs' || choice.backend === 'hap') {
      try {
        const done = await mixViaWebCodecs(runner, input, p, p.video, gains, share, { signal, onProgress });
        onProgress?.(1);
        // WebCodecs follows the crossfade's curve, which ffmpeg's xfade cannot.
        return { blob: done.file, extension: p.extension, warnings: warnings.filter((w) => w !== 'video-curve-linear'), measurement: null, release: done.release };
      } catch (e) {
        if (setting === 'webcodecs' || choice.backend === 'hap' || (e as EngineError).code === 'cancelled') throw e;
        warnings.push('webcodecs-fallback');
      }
    }
  }

  const args = p.render(gains, input.encoderThreads);
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run(
    { inputs: input.files, args, outputs: [out], duration: p.layout.duration, core: input.encoderThreads ? 'mt' : 'st' },
    { signal, onProgress: (x) => onProgress?.(share + x * (1 - share)) },
  );
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  onProgress?.(1);
  return { blob, extension: p.extension, warnings, measurement: null };
}

/** The sound of the mix by ffmpeg, the picture by WebCodecs, joined into one mp4 in OPFS. */
async function mixViaWebCodecs(
  runner: Runner,
  input: MixInput,
  p: MixPlan,
  video: NonNullable<MixPlan['video']>,
  gains: ReadonlyMap<string, number> | null,
  share: number,
  { signal, onProgress }: RunOptions,
) {
  const soundShare = 0.1;
  const args = p.renderAudio(gains);
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run(
    { inputs: input.files, args, outputs: ['mix'], duration: p.layout.duration },
    { signal, onProgress: (x) => onProgress?.(share + x * soundShare) },
  );
  const blob = r.files.get('mix');
  if (r.code !== 0 || !blob) throw failure(r.log);
  const hap = input.mix.video.format === 'hap';
  const audio = hap ? new File([blob], 'sound.wav', { type: 'audio/wav' }) : new File([blob], 'sound.m4a', { type: 'audio/mp4' });
  const from = share + soundShare;
  const { canvas } = video;
  const fps = outputFps(canvas);
  const { duration } = p.layout;
  return runMixWebCodecs(
    {
      files: [...input.files],
      audio,
      segments: video.segments,
      width: canvas.size.width,
      height: canvas.size.height,
      fps,
      rate: canvas.fps,
      hap: hap ? input.mix.video.hapVariant : null,
      duration,
      fadeIn: Math.min(input.mix.fadeIn.duration, duration),
      fadeOut: Math.min(input.mix.fadeOut.duration, duration),
      bitrate: h264Bitrate(canvas.size.width, canvas.size.height, fps, input.mix.video.h264Crf),
    },
    { signal, onProgress: (x) => onProgress?.(from + x * (1 - from)) },
  );
}

/** About 20 s around one transition, to listen to it before generating the mix. */
export async function previewTransition(
  runner: Runner,
  input: MixInput & { transition: Transition },
  options: RunOptions = {},
): Promise<{ blob: Blob; crossAt: number }> {
  const out = 'preview.wav';
  const [a, b] = input.clips as [MixClip, MixClip];
  let gains: Map<string, number> | null = null;
  if (input.mix.matchLoudness) {
    const sources = input.clips.map((c) => sourceOf(c));
    const bad = sources.find((s): s is { error: MixError } => 'error' in s);
    if (bad) throw new EngineError('invalid-input', bad.error);
    gains = await gainsFor(runner, input, sources as Source[], { signal: options.signal });
  }
  const p = previewPlan([a, b], input.transition, input.mix, gains, [inputPath(0, input.files[0]!), inputPath(1, input.files[1]!)], outputPath(out));
  if ('error' in p) throw new EngineError('invalid-input', p.error);
  const r = await runner.run({ inputs: input.files, args: p.args, outputs: [out], duration: p.duration }, options);
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  return { blob: new Blob([blob], { type: 'audio/wav' }), crossAt: p.crossAt };
}

export type ListenFormat = 'opus' | 'aac';

const LISTEN: Record<ListenFormat, { codec: string[]; muxer: string; type: string }> = {
  opus: { codec: ['-c:a', 'libopus', '-b:a', '128k'], muxer: 'ogg', type: 'audio/ogg' },
  aac: { codec: ['-c:a', 'aac', '-b:a', '192k'], muxer: 'ipod', type: 'audio/mp4' },
};

/** A copy to listen to when the browser cannot play the file itself. Same timing, audio only. */
export async function listenCopy(runner: Runner, file: File, info: MediaInfo, track: number, format: ListenFormat, options?: RunOptions): Promise<Blob> {
  const out = 'listen';
  const f = LISTEN[format];
  const args = ['-hide_banner', '-nostdin', '-y', '-i', inputPath(0, file), '-map', `0:a:${track}`, '-vn', ...f.codec, '-f', f.muxer, outputPath(out)];
  const r = await runner.run({ inputs: [file], args, outputs: [out], duration: info.duration }, options);
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  return new Blob([blob], { type: f.type });
}

export interface FrameJob {
  video: VideoTrack;
  time: number;
  format: 'png' | 'jpeg';
  picture?: OutputSettings['picture'];
}

/** One frame of a video as an image. */
export async function extractFrame(runner: Runner, file: File, job: FrameJob, options?: RunOptions): Promise<Blob> {
  const out = job.format === 'png' ? 'frame.png' : 'frame.jpg';
  const args = frameArgs({ ...job, inputPath: inputPath(0, file), outputPath: outputPath(out) });
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run({ inputs: [file], args, outputs: [out] }, options);
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  return new Blob([blob], { type: job.format === 'png' ? 'image/png' : 'image/jpeg' });
}

export interface Assessment {
  /** The engine that would make the video; null when a forced engine cannot. */
  backend: Backend | null;
  /** Times the video's length the job is expected to take. */
  ratio: number;
  slow: boolean;
}

/** What processing this file would use and how long it would take, before anything runs. Null for sound files. */
export async function assessFile(file: File, input: FileJob): Promise<Assessment | null> {
  const p = planOf(file, input, 'result');
  if (!p.video) return null;
  const choice = p.video.portable || p.video.codec === 'hap' ? chooseBackend(p.video, await detectCapabilities(p.video, file), input.videoEngine ?? 'auto') : { backend: 'ffmpeg' as const };
  const ratio = estimateRatio(p.video, choice.backend ?? 'ffmpeg', poolSize());
  return { backend: choice.backend, ratio, slow: ratio >= SLOW_RATIO };
}
