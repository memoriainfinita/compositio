import { describe, expect, it } from 'vitest';
import { serializeDoc, MONTAGE } from '../model/formats.ts';
import { media } from '../model/fixtures.ts';
import { addClips, addFiles, emptyProject } from '../model/project.ts';
import { createStore } from '../model/store.ts';
import type { StoredMontage } from '../model/storage.ts';
import { createFiles } from './files.ts';
import { stripLayout } from './mix.ts';
import { createMontageLibrary, dropMissing, openMontage } from './montages.ts';

const persisted = () => {
  const records = new Map<string, StoredMontage>();
  return { records, persist: { put: async (r: StoredMontage) => void records.set(r.id, r), remove: async (id: string) => void records.delete(id) } };
};

const project = () => addFiles(emptyProject(), [{ id: 'a', name: 'a.wav', size: 10, duration: 60 }, { id: 'b', name: 'b.wav', size: 20, duration: 30 }]);

describe('montage library', () => {
  it('saves, replaces the montage the work came from, or saves a new one', () => {
    const { records, persist } = persisted();
    let t = 0;
    const lib = createMontageLibrary([], persist, () => ++t);
    const id = lib.save(project(), ' Gira ');
    expect(lib.list.value.map((e) => e.montage?.name)).toEqual(['Gira']);
    expect(records.get(id)?.doc).toMatchObject({ format: 'compositio.montage', version: 1, id, name: 'Gira' });
    const again = lib.save({ ...project(), id }, 'Gira 2');
    expect(again).toBe(id);
    const copy = lib.save({ ...project(), id }, 'Copia', true);
    expect(copy).not.toBe(id);
    expect(lib.list.value.map((e) => e.montage?.name)).toEqual(['Copia', 'Gira 2']);
    lib.remove(copy);
    expect(records.has(copy)).toBe(false);
  });

  it('shows a montage from a newer version without ever writing over it', () => {
    const { persist } = persisted();
    const lib = createMontageLibrary([{ id: 'new', savedAt: 1, doc: { format: 'compositio.montage', version: 99 } }], persist);
    expect(lib.list.value[0]).toMatchObject({ montage: null, error: { code: 'too-new', version: 99 } });
    expect(lib.save({ ...project(), id: 'new' }, 'x')).not.toBe('new');
  });

  it('exports without the local id and imports with a new one', () => {
    const { persist } = persisted();
    const lib = createMontageLibrary([], persist);
    const id = lib.save(project(), 'Gira');
    const text = lib.exportText(id)!;
    expect(JSON.parse(text)).toMatchObject({ format: 'compositio.montage', id: null, name: 'Gira' });
    const r = lib.importText(text);
    expect(r.ok && r.id !== id).toBe(true);
    expect(lib.importText('{"format":"other"}')).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
  });

  it('gives the mix duration from the saved durations', () => {
    const p = addClips(project(), ['a', 'b']);
    expect(stripLayout(p).duration).toBe(60 + 30 - 6);
  });
});

describe('openMontage', () => {
  it('opens in one undo step and brings along the files already here', () => {
    const store = createStore(project());
    const files = createFiles(store);
    const fa = new File(['x'], 'a.wav');
    files.sources.value = new Map([['a', fa]]);
    files.infos.value = new Map([['a', media()]]);
    const saved = serializeDoc(MONTAGE, { ...addFiles(emptyProject(), [{ id: 'x', name: 'a.wav', size: 10, duration: 60 }, { id: 'y', name: 'c.wav', size: 5, duration: 9 }]), id: 'm', name: 'Gira' });
    const lib = createMontageLibrary([{ id: 'm', savedAt: 1, doc: saved }], persisted().persist);

    const missing = openMontage(store, files, lib.list.value[0]!.montage!);
    expect(missing).toBe(1);
    expect(store.get().name).toBe('Gira');
    expect(files.sources.value.get('x')).toBe(fa);
    expect(files.infos.value.has('x')).toBe(true);
    expect([...files.selected.value]).toEqual(['x']);
    expect(files.active.value).toBe('x');

    dropMissing(store, files);
    expect(store.get().files.map((f) => f.id)).toEqual(['x']);
    store.undo();
    store.undo();
    expect(store.get().files.map((f) => f.id)).toEqual(['a', 'b']);
  });
});
