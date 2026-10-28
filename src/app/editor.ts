// What the editor asks of the engine for the active file: its waveform, a copy to listen to when
// the browser cannot play it, and normalizing's measurement for B. Each is asked once; results
// live in the session (`Files`), like the silences. Every other file's waveform is asked for
// behind everything else, for the mix strip and so the editor finds it ready.

import type { Engine, ListenFormat } from '../engine/index.ts';
import type { FileEdits, Silences } from '../model/edits.ts';
import { audioTracks, type MediaInfo } from '../model/media.ts';
import type { Project } from '../model/project.ts';
import { effectiveSettings, type OutputSettings } from '../model/settings.ts';
import type { Files } from './files.ts';

export type EditorEngine = Pick<Engine, 'peaks' | 'measure' | 'listen' | 'queue'>;

const asked = new WeakMap<Files, Set<string>>();

/** True the first time a key is asked for these files; later calls wait for that first one. */
function once(files: Files, key: string): boolean {
  const set = asked.get(files) ?? new Set<string>();
  asked.set(files, set);
  if (set.has(key)) return false;
  set.add(key);
  return true;
}
const forget = (files: Files, key: string) => asked.get(files)?.delete(key);

const put = <V>(map: ReadonlyMap<string, V>, key: string, value: V): Map<string, V> => new Map([...map, [key, value]]);

/** The track the editor shows and plays: the one «Extraer audio» keeps. */
export function editorTrack(info: MediaInfo, settings: OutputSettings): number {
  const tracks = audioTracks(info);
  const at = tracks.findIndex((t) => t.index === settings.extract.track);
  return Math.max(at, 0);
}

/** Waveform jobs by key, so the editor can move one that waits in the background ahead. */
const peakJobs = new WeakMap<Files, Map<string, string>>();

export function wantPeaks(files: Files, engine: EditorEngine, id: string, track: number, priority: 'view' | 'background' = 'view'): void {
  const file = files.sources.value.get(id);
  const info = files.infos.value.get(id);
  const key = `peaks|${id}|${track}`;
  if (!file || !info || audioTracks(info).length === 0) return;
  const jobs = peakJobs.get(files) ?? new Map<string, string>();
  peakJobs.set(files, jobs);
  if (!once(files, key)) {
    const job = jobs.get(key);
    if (job) engine.queue.raise(job, priority);
    return;
  }
  const job = engine.peaks(file, info, track, (p) => (files.peaks.value = put(files.peaks.value, id, { ...p })), priority);
  jobs.set(key, job.id);
  job.result.catch(() => forget(files, key));
}

/** Every file's waveform, with the track the editor would show, behind any other work. */
export function wantAllPeaks(files: Files, engine: EditorEngine, project: Project): void {
  for (const f of project.files) {
    const info = files.infos.value.get(f.id);
    if (info) wantPeaks(files, engine, f.id, editorTrack(info, effectiveSettings(project.batch, f.edits.own)), 'background');
  }
}

export function wantListening(files: Files, engine: EditorEngine, id: string, track: number, format: ListenFormat): void {
  const file = files.sources.value.get(id);
  const info = files.infos.value.get(id);
  if (!file || !info || !once(files, `listen|${id}`)) return;
  engine.listen(file, info, track, format).then(
    (blob) => (files.listening.value = put(files.listening.value, id, URL.createObjectURL(blob))),
    () => forget(files, `listen|${id}`),
  );
}

/** What normalizing's measurement depends on: the cut, the fades and its own settings. */
export const measureKey = (id: string, edits: FileEdits, settings: OutputSettings, silences: Silences | null): string =>
  JSON.stringify([id, edits.in, edits.out, edits.fadeIn, edits.fadeOut, settings.extract, settings.trim, settings.normalize, settings.trim.silence ? silences : null]);

export function wantMeasurement(files: Files, engine: EditorEngine, id: string, edits: FileEdits, settings: OutputSettings): void {
  const file = files.sources.value.get(id);
  const info = files.infos.value.get(id);
  const silences = files.silences.value.get(id) ?? null;
  if (!file || !info || !settings.normalize.enabled) return;
  const key = measureKey(id, edits, settings, silences);
  if (files.measurements.value.has(key) || !once(files, key)) return;
  engine.measure(file, { info, edits, settings, silences }).then(
    (m) => {
      if (m) files.measurements.value = put(files.measurements.value, key, m);
    },
    () => forget(files, key),
  );
}
