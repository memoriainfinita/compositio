// «Procesar»: from the selected files to queued jobs with their names, and from the results in
// «Exportaciones» to downloads, file by file or as one zip. Nothing downloads by itself.

import { downloadZip } from 'client-zip';
import type { Engine, JobView, Processed } from '../engine/index.ts';
import type { FileRef } from '../model/formats.ts';
import type { MediaInfo } from '../model/media.ts';
import { applyPattern, disambiguate } from '../model/naming.ts';
import { plan, type PlanError } from '../model/operations.ts';
import type { Project } from '../model/project.ts';
import { effectiveSettings, type OutputSettings } from '../model/settings.ts';
import type { Files } from './files.ts';

export interface Prepared {
  id: string;
  file: File;
  info: MediaInfo;
  settings: OutputSettings;
  /** Output file name, unique in the batch. */
  name: string;
}

export interface Preparation {
  items: Prepared[];
  /** Files the plan refuses (no audio track, empty range), with why. */
  refused: { id: string; name: string; error: PlanError }[];
}

/**
 * The ids «Procesar» takes: the checked ones that are here, in the order of the list; with none
 * checked, the file in the editor. `active` says which of the two it is.
 */
export function processable(project: Project, files: Files): { ids: string[]; active: boolean } {
  const ids = project.files.filter((f) => files.selected.value.has(f.id) && files.sources.value.has(f.id)).map((f) => f.id);
  const editing = files.active.value;
  if (ids.length || !editing || !files.sources.value.has(editing) || !project.files.some((f) => f.id === editing)) return { ids, active: false };
  return { ids: [editing], active: true };
}

/**
 * Plans every file to know its extension, then names them all at once so that names colliding in
 * the batch get told apart. `settingsFor` gives the batch with the file's own values, or a preset.
 */
export function prepare(project: Project, files: Files, ids: readonly string[], settingsFor: (f: FileRef) => OutputSettings): Preparation {
  const planned: { ref: FileRef; file: File; info: MediaInfo; settings: OutputSettings; extension: string }[] = [];
  const refused: Preparation['refused'] = [];
  for (const ref of project.files) {
    if (!ids.includes(ref.id)) continue;
    const file = files.sources.value.get(ref.id);
    const info = files.infos.value.get(ref.id);
    if (!file || !info) continue;
    const settings = settingsFor(ref);
    const silences = files.silences.value.get(ref.id) ?? null;
    const p = plan({ info, edits: ref.edits, settings, silences, inputPath: 'in', outputPath: 'out' });
    if ('error' in p) refused.push({ id: ref.id, name: ref.name, error: p.error });
    else planned.push({ ref, file, info, settings, extension: p.extension });
  }
  const names = disambiguate(
    planned.map((x, i) =>
      applyPattern(
        x.settings.output.pattern,
        { name: x.ref.name, n: i + 1, total: planned.length, title: x.info.tags.title, artist: x.info.tags.artist },
        x.extension,
      ),
    ),
  );
  return { items: planned.map((x, i) => ({ id: x.ref.id, file: x.file, info: x.info, settings: x.settings, name: names[i]! })), refused };
}

export const batchSettings = (project: Project) => (f: FileRef): OutputSettings => effectiveSettings(project.batch, f.edits.own);

/** Hands a file to the browser's downloads. */
export function save(name: string, blob: Blob, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  // The download has taken the blob by the next minute; the URL can go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function zip(entries: readonly { name: string; blob: Blob }[]): Promise<Blob> {
  return downloadZip(entries.map((e) => ({ name: e.name, input: e.blob, lastModified: new Date() }))).blob();
}

export type Saver = (name: string, blob: Blob) => void;

/**
 * Queues one job per file. The results stay with their jobs, for «Exportaciones»; the promise
 * gives, once every job has ended, the ids of the ones that worked.
 */
export function run(engine: Pick<Engine, 'process'>, files: Files, project: Project, items: readonly Prepared[]): Promise<string[]> {
  const jobs = items.map((item) => {
    const ref = project.files.find((f) => f.id === item.id)!;
    const input = { info: item.info, edits: ref.edits, settings: item.settings, silences: files.silences.value.get(item.id) ?? null };
    const { id, result } = engine.process(item.name, item.file, input);
    return result.then(
      () => id,
      () => null,
    );
  });
  return Promise.all(jobs).then((ids) => ids.filter((id): id is string => id !== null));
}

/**
 * Downloads results: one alone as itself; several file by file, or as one zip when `together`.
 * Firefox on Android keeps only the first of several downloads in a row: there they always go
 * together.
 */
export async function download(entries: readonly { name: string; blob: Blob }[], zipName: string, together: boolean, saver: Saver = save): Promise<void> {
  if (entries.length === 1) return saver(entries[0]!.name, entries[0]!.blob);
  if (together) return saver(zipName, await zip(entries));
  for (const e of entries) saver(e.name, e.blob);
}

/** Whether several downloads in a row reach the user here; touch-first browsers only keep the first. */
export const separateDownloads = (): boolean => !matchMedia('(pointer: coarse)').matches;

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  active: number;
  /** Mean progress of the user's jobs, from 0 to 1. */
  progress: number;
}

/** What the queue bar says: only the user's jobs count. */
export function summarize(jobs: readonly JobView[]): QueueSummary {
  const mine = jobs.filter((j) => j.priority === 'user');
  const total = mine.length;
  const done = mine.filter((j) => j.status === 'done').length;
  const failed = mine.filter((j) => j.status === 'failed' || j.status === 'cancelled').length;
  const active = mine.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const progress = total ? mine.reduce((s, j) => s + (j.status === 'done' ? 1 : j.progress), 0) / total : 0;
  return { total, done, failed, active, progress };
}

/** Finished results still in memory, the ones «Exportaciones» lists. */
export const finished = (jobs: readonly JobView[]): { id: string; name: string; blob: Blob }[] =>
  jobs.flatMap((j) => (j.priority === 'user' && j.status === 'done' && j.result ? [{ id: j.id, name: j.label, blob: (j.result as Processed).blob }] : []));
