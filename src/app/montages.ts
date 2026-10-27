// The montages library: saved in IndexedDB outside undo, exported and imported as
// `compositio.montage` files. Opening one is an undo step; the files already in the session that
// match its references come along with what was found out about them.

import { signal, type Signal } from '@preact/signals';
import { MONTAGE, parseDoc, serializeDoc, type Montage, type ParseError } from '../model/formats.ts';
import { markSaved, newId, pairFiles, removeFiles, type Project } from '../model/project.ts';
import type { StoredMontage } from '../model/storage.ts';
import type { Store } from '../model/store.ts';
import type { Files } from './files.ts';

export interface Entry {
  id: string;
  savedAt: number;
  /** Null when this version cannot read it (a newer one wrote it, or it is damaged). */
  montage: Montage | null;
  error: ParseError | null;
}

export interface Persist {
  put(record: StoredMontage): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface MontageLibrary {
  /** Most recently saved first. */
  list: Signal<readonly Entry[]>;
  /** Saves the project under `name`; replaces the montage it came from unless `asNew`. Returns its id. */
  save(project: Project, name: string, asNew?: boolean): string;
  remove(id: string): void;
  /** Adds the montage of an exported file with an id of its own. */
  importText(text: string): { ok: true; id: string } | { ok: false; error: ParseError };
  exportText(id: string): string | null;
}

const toEntry = (r: StoredMontage): Entry => {
  const parsed = parseDoc(MONTAGE, r.doc);
  return parsed.ok ? { id: r.id, savedAt: r.savedAt, montage: { ...parsed.value, id: r.id }, error: null } : { id: r.id, savedAt: r.savedAt, montage: null, error: parsed.error };
};

const byDate = (list: readonly Entry[]): Entry[] => [...list].sort((a, b) => b.savedAt - a.savedAt);

export function createMontageLibrary(initial: readonly StoredMontage[], persist: Persist, now: () => number = Date.now): MontageLibrary {
  const list = signal<readonly Entry[]>(byDate(initial.map(toEntry)));
  const fail = (e: unknown) => console.error('montages', e);

  const put = (montage: Montage): string => {
    const id = montage.id!;
    const savedAt = now();
    void persist.put({ id, savedAt, doc: serializeDoc(MONTAGE, montage) }).catch(fail);
    list.value = byDate([...list.value.filter((e) => e.id !== id), { id, savedAt, montage, error: null }]);
    return id;
  };

  return {
    list,
    save(project, name, asNew = false) {
      const current = project.id ? list.value.find((e) => e.id === project.id) : undefined;
      // An entry this version cannot read is never written over.
      const id = !asNew && current?.montage ? current.id : newId();
      return put(markSaved(project, id, name.trim().slice(0, 200)));
    },
    remove(id) {
      void persist.remove(id).catch(fail);
      list.value = list.value.filter((e) => e.id !== id);
    },
    importText(text) {
      const parsed = parseDoc(MONTAGE, text);
      if (!parsed.ok) return parsed;
      return { ok: true, id: put({ ...parsed.value, id: newId() }) };
    },
    exportText(id) {
      const m = list.value.find((e) => e.id === id)?.montage;
      // The id is this browser's; a file carries none.
      return m ? JSON.stringify(serializeDoc(MONTAGE, { ...m, id: null }), null, 2) : null;
    },
  };
}

const withEntries = <V>(map: ReadonlyMap<string, V>, entries: Iterable<[string, V]>): Map<string, V> => new Map([...map, ...entries]);

/**
 * Opens a montage in one undo step. Files of the session that match its references by name and
 * size (or by name alone, when only one has it) come along: their File, info, silences and peaks
 * move to the new references. Returns how many of its files are still missing.
 */
export function openMontage(store: Store, files: Files, montage: Montage): number {
  const current = store.get();
  const here = current.files.filter((f) => files.sources.value.has(f.id));
  const pairs = pairFiles(montage.files, here.map((f) => ({ name: f.name, size: f.size })));
  const moved = [...pairs].map(([to, i]) => [to, here[i]!.id] as const);
  const carry = <V>(map: ReadonlyMap<string, V>) => withEntries(map, moved.flatMap(([to, from]) => (map.has(from) ? [[to, map.get(from)!] as [string, V]] : [])));
  files.sources.value = carry(files.sources.value);
  files.infos.value = carry(files.infos.value);
  files.silences.value = carry(files.silences.value);
  files.peaks.value = carry(files.peaks.value);
  store.run(() => structuredClone(montage));
  files.selected.value = new Set(moved.map(([to]) => to));
  files.active.value = moved[0]?.[0] ?? null;
  return montage.files.length - moved.length;
}

/** «Abrir sin los que faltan». */
export function dropMissing(store: Store, files: Files): void {
  const gone = store.get().files.filter((f) => !files.sources.value.has(f.id)).map((f) => f.id);
  if (gone.length) store.run((p) => removeFiles(p, gone));
}
