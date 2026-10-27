// Jobs on top of a Runner: read what a file contains, find its silences, process it with a plan
// from the model. WebCodecs, for video, would implement jobs like these without a Runner.

import type { Silences } from '../model/edits.ts';
import { keptRange, rangeLength } from '../model/edits.ts';
import type { MediaInfo } from '../model/media.ts';
import { parseMeasurement, plan, type Measurement, type PlanInput, type Warning } from '../model/operations.ts';
import { parseSilences, PROBE_ARGS, silenceFilter, toMediaInfo, type ProbeJson } from './probe.ts';
import { EngineError, failure, inputPath, outputPath, type RunOptions, type Runner } from './runner.ts';

export async function probeFile(runner: Runner, file: File, options?: RunOptions): Promise<MediaInfo> {
  const out = 'probe.json';
  const r = await runner.run(
    { tool: 'ffprobe', inputs: [file], args: [...PROBE_ARGS, inputPath(0, file), '-o', outputPath(out)], outputs: [out] },
    options,
  );
  // ffprobe in ffmpeg.wasm exits with -1 even on success: its JSON is the only verdict.
  const blob = r.files.get(out);
  const json = blob ? await blob.text() : '';
  try {
    const parsed = JSON.parse(json) as ProbeJson;
    if (!parsed.format && !parsed.streams?.length) throw new Error('empty probe');
    return toMediaInfo(parsed);
  } catch {
    throw failure([...r.log, json]);
  }
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
