// Jobs on top of a Runner: read what a file contains, find its silences, process it with a plan
// from the model. WebCodecs, for video, would implement jobs like these without a Runner.

import type { Silences } from '../model/edits.ts';
import { keptRange, rangeLength } from '../model/edits.ts';
import type { MediaInfo } from '../model/media.ts';
import { matchGain, measureArgs, measureKeyOf, mixPlan, previewPlan, sourceOf, type MixClip, type MixError, type Source } from '../model/mix.ts';
import { parseMeasurement, plan, type Measurement, type PlanInput, type Warning } from '../model/operations.ts';
import type { MixSettings, Transition } from '../model/timeline.ts';
import { parseSilences, PROBE_ARGS, silenceFilter, toMediaInfo, type ProbeJson } from './probe.ts';
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
}

/** The measuring pass decodes only; it weighs less in the progress than the render. */
const MEASURE_SHARE = 0.3;

export async function processFile(
  runner: Runner,
  file: File,
  input: Omit<PlanInput, 'inputPath' | 'outputPath'>,
  { signal, onProgress }: RunOptions = {},
): Promise<Processed> {
  const out = 'result';
  const p = plan({ ...input, inputPath: inputPath(0, file), outputPath: outputPath(out) });
  if ('error' in p) throw new EngineError('invalid-input', p.error);
  const range = keptRange(input.edits, input.info.duration, input.settings.trim.silence ? input.silences : null);
  const duration = rangeLength(range);

  let measurement: Measurement | null = null;
  let share = 0;
  if (p.measure) {
    share = MEASURE_SHARE;
    const r = await runner.run(
      { inputs: [file], args: p.measure.args, outputs: [], duration },
      { signal, onProgress: (x) => onProgress?.(x * share) },
    );
    if (r.code !== 0) throw failure(r.log);
    measurement = parseMeasurement(p.measure.kind, r.log.join('\n'));
    if (!measurement) throw new EngineError('unexpected-output', r.log.slice(-12).join('\n'));
  }

  const args = p.render(measurement);
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run(
    { inputs: [file], args, outputs: [out], duration },
    { signal, onProgress: (x) => onProgress?.(share + x * (1 - share)) },
  );
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  onProgress?.(1);
  return { blob, extension: p.extension, warnings: p.warnings, measurement };
}

/** Only the first pass of a plan: what normalizing needs to know, for the editor's B. */
export async function measureFile(
  runner: Runner,
  file: File,
  input: Omit<PlanInput, 'inputPath' | 'outputPath'>,
  options?: RunOptions,
): Promise<Measurement | null> {
  const p = plan({ ...input, inputPath: inputPath(0, file), outputPath: outputPath('result') });
  if ('error' in p) throw new EngineError('invalid-input', p.error);
  if (!p.measure) return null;
  const duration = rangeLength(keptRange(input.edits, input.info.duration, input.settings.trim.silence ? input.silences : null));
  const r = await runner.run({ inputs: [file], args: p.measure.args, outputs: [], duration }, options);
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
    const key = measureKeyOf(c.clip.fileId, source);
    let m = input.measured.get(key);
    if (!m) {
      const file = input.files[i]!;
      const r = await runner.run({ inputs: [file], args: measureArgs(source, inputPath(0, file)), outputs: [], duration: source.length }, { signal });
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

export async function mixFiles(runner: Runner, input: MixInput, { signal, onProgress }: RunOptions = {}): Promise<Processed> {
  const out = 'mix';
  const p = mixPlan(input.clips, input.mix, input.files.map((f, i) => inputPath(i, f)), outputPath(out));
  if ('error' in p) throw new EngineError('invalid-input', p.error);
  const share = input.mix.matchLoudness ? MEASURE_SHARE : 0;
  const gains = input.mix.matchLoudness ? await gainsFor(runner, input, p.sources, { signal, onProgress: (x) => onProgress?.(x * share) }) : null;
  const args = p.render(gains);
  if (!Array.isArray(args)) throw new EngineError('invalid-input', args.error);
  const r = await runner.run(
    { inputs: input.files, args, outputs: [out], duration: p.layout.duration },
    { signal, onProgress: (x) => onProgress?.(share + x * (1 - share)) },
  );
  const blob = r.files.get(out);
  if (r.code !== 0 || !blob) throw failure(r.log);
  onProgress?.(1);
  return { blob, extension: p.extension, warnings: [], measurement: null };
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
    const sources = input.clips.map(sourceOf);
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
