// Persistent storage in IndexedDB: the work in progress, presets and app settings. Everything is
// stored in its saved format, so reading it back goes through the same migrations as a file.

import { APP_SETTINGS, MONTAGE, PRESETS, parseDoc, serializeDoc, type AppSettings, type FormatDef, type Montage, type ParseError, type Preset } from './formats.ts';

const DB_NAME = 'compositio';
const DB_VERSION = 1;
const KV = 'kv';
const KEYS = { session: 'session', presets: 'presets', settings: 'settings' } as const;

export type Loaded<T> = { ok: true; value: T | null } | { ok: false; error: ParseError };

export interface Storage {
  loadSession(): Promise<Loaded<Montage>>;
  saveSession(montage: Montage): Promise<void>;
  clearSession(): Promise<void>;
  loadPresets(): Promise<Loaded<Preset[]>>;
  savePresets(presets: readonly Preset[]): Promise<void>;
  loadSettings(): Promise<Loaded<AppSettings>>;
  saveSettings(settings: AppSettings): Promise<void>;
  close(): void;
}

const promised = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function openStorage(factory: IDBFactory = indexedDB): Promise<Storage> {
  const open = factory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(KV)) open.result.createObjectStore(KV);
  };
  const db = await promised(open);

  const get = async (key: string): Promise<unknown> => promised(db.transaction(KV).objectStore(KV).get(key));
  const put = async (key: string, value: unknown): Promise<void> => {
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  const load = async <T, R>(key: string, def: FormatDef<T>, pick: (v: T) => R): Promise<Loaded<R>> => {
    const raw = await get(key);
    if (raw === undefined) return { ok: true, value: null };
    const parsed = parseDoc(def, raw);
    return parsed.ok ? { ok: true, value: pick(parsed.value) } : parsed;
  };

  return {
    loadSession: () => load(KEYS.session, MONTAGE, (m) => m),
    saveSession: (montage) => put(KEYS.session, serializeDoc(MONTAGE, montage)),
    clearSession: async () => {
      const tx = db.transaction(KV, 'readwrite');
      await promised(tx.objectStore(KV).delete(KEYS.session));
    },
    loadPresets: () => load(KEYS.presets, PRESETS, (p) => p.presets),
    savePresets: (presets) => put(KEYS.presets, serializeDoc(PRESETS, { presets: [...presets] })),
    loadSettings: () => load(KEYS.settings, APP_SETTINGS, (s) => s),
    saveSettings: (settings) => put(KEYS.settings, serializeDoc(APP_SETTINGS, settings)),
    close: () => db.close(),
  };
}

export interface Usage {
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

/** Asks the browser not to evict our data; it may say no, and the app works either way. */
export async function requestPersistence(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<Usage> {
  if (!storage) return { persisted: false, usage: null, quota: null };
  const persisted = (await storage.persisted?.()) || ((await storage.persist?.()) ?? false);
  const estimate = (await storage.estimate?.()) ?? {};
  return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export interface Autosave<T> {
  schedule(value: T): void;
  /** Saves now what is pending, as before closing or reloading. */
  flush(): Promise<void>;
  cancel(): void;
}

/** Saves the last value once changes stop for `delay` ms; saves never overlap. */
export function createAutosave<T>(save: (value: T) => Promise<void>, onError: (e: unknown) => void, delay = 1000): Autosave<T> {
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const job = pending;
    pending = null;
    if (job) running = running.then(() => save(job.value)).catch(onError);
    return running;
  };

  return {
    schedule(value) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
