import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFiles, emptyProject } from './project.ts';
import { defaultSettings } from './settings.ts';
import { createAutosave, openStorage, requestPersistence } from './storage.ts';

describe('storage', () => {
  it('starts empty and keeps what is saved across openings', async () => {
    const factory = new IDBFactory();
    const first = await openStorage(factory);
    expect(await first.loadSession()).toEqual({ ok: true, value: null });
    const p = addFiles(emptyProject(), [{ id: 'a', name: 'a.wav', size: 1, duration: 2 }]);
    await first.saveSession(p);
    await first.savePresets([{ id: 'p', name: 'Teatro', settings: defaultSettings() }]);
    await first.saveSettings({ language: 'es', defaultPresetId: 'p' });
    first.close();

    const second = await openStorage(factory);
    expect(await second.loadSession()).toEqual({ ok: true, value: p });
    const presets = await second.loadPresets();
    expect(presets.ok && presets.value?.map((x) => x.name)).toEqual(['Teatro']);
    expect(await second.loadSettings()).toEqual({ ok: true, value: { language: 'es', defaultPresetId: 'p' } });
    await second.clearSession();
    expect(await second.loadSession()).toEqual({ ok: true, value: null });
    second.close();
  });

  it('reports stored data it cannot read instead of losing it silently', async () => {
    const factory = new IDBFactory();
    const s = await openStorage(factory);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open('compositio', 2);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ format: 'compositio.montage', version: 99 }, 'session');
      tx.oncomplete = resolve;
    });
    expect(await s.loadSession()).toEqual({ ok: false, error: { code: 'too-new', version: 99 } });
    db.close();
    s.close();
  });

  it('keeps saved montages apart, one record each', async () => {
    const factory = new IDBFactory();
    const s = await openStorage(factory);
    await s.putMontage({ id: 'm1', savedAt: 1, doc: { format: 'compositio.montage', version: 1, files: [] } });
    await s.putMontage({ id: 'm2', savedAt: 2, doc: { format: 'compositio.montage', version: 1, files: [] } });
    await s.putMontage({ id: 'm1', savedAt: 3, doc: { format: 'compositio.montage', version: 1, files: [], name: 'b' } });
    await s.deleteMontage('m2');
    expect(await s.listMontages()).toEqual([{ id: 'm1', savedAt: 3, doc: { format: 'compositio.montage', version: 1, files: [], name: 'b' } }]);
    s.close();
  });
});

describe('requestPersistence', () => {
  it('asks once and reports the space in use', async () => {
    const persist = vi.fn(async () => true);
    const manager = { persisted: async () => false, persist, estimate: async () => ({ usage: 1234, quota: 10_000 }) };
    expect(await requestPersistence(manager as unknown as StorageManager)).toEqual({ persisted: true, usage: 1234, quota: 10_000 });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('works without a storage manager', async () => {
    expect(await requestPersistence(undefined)).toEqual({ persisted: false, usage: null, quota: null });
  });
});

describe('createAutosave', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the last value once changes stop', async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const a = createAutosave(async (n: number) => void saved.push(n), () => {}, 1000);
    a.schedule(1);
    await vi.advanceTimersByTimeAsync(500);
    a.schedule(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([2]);
  });

  it('flushes at once and reports errors without stopping', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const saved: number[] = [];
    const a = createAutosave(
      async (n: number) => {
        if (fail) throw new Error('quota');
        saved.push(n);
      },
      (e) => errors.push(e),
    );
    a.schedule(1);
    await a.flush();
    fail = false;
    a.schedule(2);
    await a.flush();
    expect(errors).toHaveLength(1);
    expect(saved).toEqual([2]);
    a.cancel();
  });
});
