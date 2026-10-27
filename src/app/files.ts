// The files of this session: their File objects, what ffprobe found, their silences, the batch
// selection, the active file and the alerts. None of it is saved or undone; the project only keeps
// the references (spec, «Modelo»).

import { signal, type Signal } from '@preact/signals';
import type { Silences } from '../model/edits.ts';
import { audioTracks, isVideo, type MediaInfo } from '../model/media.ts';
import { addFiles, newId } from '../model/project.ts';
import type { Store } from '../model/store.ts';
import { sortIncoming, type Incoming } from './intake.ts';

export type Alert =
  | { id: string; kind: 'too-big'; name: string; size: number }
  | { id: string; kind: 'not-media'; names: string[] }
  | { id: string; kind: 'single-thread' };

/** What the files need from the engine. */
export interface Analyzer {
  multithread: boolean;
  probe(file: File): Promise<MediaInfo>;
  silences(file: File, info: MediaInfo, track?: number): Promise<Silences>;
}

export interface Files {
  sources: Signal<ReadonlyMap<string, File>>;
  infos: Signal<ReadonlyMap<string, MediaInfo>>;
  silences: Signal<ReadonlyMap<string, Silences>>;
  /** Files in the batch: the ones «Procesar» takes. Never a missing file. */
  selected: Signal<ReadonlySet<string>>;
  /** The file in the editor. */
  active: Signal<string | null>;
  /** Files probed so far out of those waiting, across every batch still being analysed. */
  analyzing: Signal<{ done: number; total: number } | null>;
  alerts: Signal<readonly Alert[]>;
}

export function createFiles(store: Store): Files {
  const files: Files = {
    sources: signal(new Map()),
    infos: signal(new Map()),
    silences: signal(new Map()),
    selected: signal(new Set()),
    active: signal(null),
    analyzing: signal(null),
    alerts: signal([]),
  };
  // Undoing an addition, or removing files, takes them out of the selection and the editor. Their
  // File stays in `sources`, so redoing brings them back whole.
  store.subscribe((p) => {
    const ids = new Set(p.files.map((f) => f.id));
    const selected = [...files.selected.value].filter((id) => ids.has(id));
    if (selected.length !== files.selected.value.size) files.selected.value = new Set(selected);
    if (files.active.value !== null && !ids.has(files.active.value)) files.active.value = null;
  });
  return files;
}

/** Files of batches still being probed, so a second drop meanwhile does not add them twice. */
const pending = new WeakMap<Files, File[]>();

const withEntries = <K, V>(map: ReadonlyMap<K, V>, entries: Iterable<[K, V]>): Map<K, V> => new Map([...map, ...entries]);

export interface AddReport {
  added: number;
  paired: number;
  duplicates: number;
}

/**
 * Takes one batch into the project: filters it, probes every file in the background queue and adds
 * the readable ones together, in a single undo step. Silences are found afterwards.
 */
export async function addIncoming(store: Store, files: Files, engine: Analyzer, batch: readonly Incoming[]): Promise<AddReport> {
  const project = store.get();
  const sources = files.sources.value;
  const waiting = pending.get(files) ?? [];
  const present = [...project.files.flatMap((f) => sources.get(f.id) ?? []), ...waiting];
  const missing = project.files.filter((f) => !sources.has(f.id));
  const sorted = sortIncoming(batch, present, missing);

  const alerts: Alert[] = sorted.tooBig.map((f) => ({ id: newId(), kind: 'too-big', name: f.name, size: f.size }));
  const toProbe: [string, File][] = [...sorted.paired, ...sorted.accepted.map((item): [string, File] => [newId(), item.file])];
  const fresh = new Set(toProbe.slice(sorted.paired.size).map(([id]) => id));

  const count = (done: number, total: number) => {
    const now = files.analyzing.value ?? { done: 0, total: 0 };
    const next = { done: now.done + done, total: now.total + total };
    files.analyzing.value = next.done >= next.total ? null : next;
  };
  count(0, toProbe.length);
  const mine = toProbe.map(([, file]) => file);
  pending.set(files, [...waiting, ...mine]);

  const probing = Promise.all(
    toProbe.map(async ([id, file]) => {
      const info = await engine.probe(file).catch(() => null);
      count(1, 0);
      // A file ffprobe reads but that holds neither sound nor picture is not media either.
      return { id, file, info: info && info.tracks.length > 0 ? info : null };
    }),
  );
  const probed = await probing.finally(() => pending.set(files, (pending.get(files) ?? []).filter((f) => !mine.includes(f))));
  const good = probed.filter((p): p is typeof p & { info: MediaInfo } => p.info !== null);
  const unreadable = [...sorted.notMedia.map((f) => f.name), ...probed.filter((p) => !p.info).map((p) => p.file.name)];
  if (unreadable.length) alerts.push({ id: newId(), kind: 'not-media', names: unreadable });

  files.sources.value = withEntries(files.sources.value, good.map((p) => [p.id, p.file]));
  files.infos.value = withEntries(files.infos.value, good.map((p) => [p.id, p.info]));
  const added = good.filter((p) => fresh.has(p.id));
  store.run((p) => addFiles(p, added.map((a) => ({ id: a.id, name: a.file.name, size: a.file.size, duration: a.info.duration }))));
  files.selected.value = new Set([...files.selected.value, ...good.map((p) => p.id)]);
  if (files.active.value === null && good.length) files.active.value = good[0]!.id;

  const alerted = files.alerts.value.some((a) => a.kind === 'single-thread');
  if (!engine.multithread && !alerted && added.some((a) => isVideo(a.info))) alerts.push({ id: newId(), kind: 'single-thread' });
  if (alerts.length) files.alerts.value = [...files.alerts.value, ...alerts];

  // Behind any work the user asks for: the queue runs background jobs last.
  for (const { id, file, info } of good) {
    if (audioTracks(info).length === 0) continue;
    engine.silences(file, info).then(
      (s) => (files.silences.value = withEntries(files.silences.value, [[id, s]])),
      () => {},
    );
  }
  return { added: added.length, paired: good.length - added.length, duplicates: sorted.duplicates.length };
}

export const dismissAlert = (files: Files, id: string): void => {
  files.alerts.value = files.alerts.value.filter((a) => a.id !== id);
};

/** Ids that can go in the batch: the files whose File is here. */
export const selectable = (store: Store, files: Files): string[] => store.get().files.flatMap((f) => (files.sources.value.has(f.id) ? [f.id] : []));

export function toggleSelected(files: Files, id: string, on: boolean): void {
  if (on && !files.sources.value.has(id)) return;
  const next = new Set(files.selected.value);
  if (on) next.add(id);
  else next.delete(id);
  files.selected.value = next;
}

export function selectAll(store: Store, files: Files, on: boolean): void {
  files.selected.value = new Set(on ? selectable(store, files) : []);
}
