// The presets library: kept in IndexedDB outside undo, exported and imported as
// `compositio.presets` files. A first run gets three starters, which can be deleted like any other.

import { signal, type Signal } from '@preact/signals';
import { PRESETS, parseDoc, serializeDoc, type ParseError, type Preset } from '../model/formats.ts';
import { newId } from '../model/project.ts';
import { defaultSettings, type OutputSettings } from '../model/settings.ts';

export interface PresetStore {
  list: Signal<readonly Preset[]>;
  add(name: string, settings: OutputSettings): Preset;
  rename(id: string, name: string): void;
  remove(id: string): void;
  /** Adds the presets of an exported file; ids already present get new ones. */
  importText(text: string): { ok: true; added: number } | { ok: false; error: ParseError };
  exportText(ids?: readonly string[]): string;
}

/** «WAV 48 kHz 24 bit», «Teatro: WAV 48 kHz, -14 LUFS», «MP3 320». Names in the language of the first run. */
export function starterPresets(names: readonly [string, string, string]): Preset[] {
  const wav = defaultSettings();
  wav.convert = { ...wav.convert, format: 'wav', sampleRate: 48000, bitDepth: 24 };
  const theatre = structuredClone(wav);
  theatre.normalize = { ...theatre.normalize, enabled: true, mode: 'lufs', lufs: -14 };
  const mp3 = defaultSettings();
  mp3.convert = { ...mp3.convert, format: 'mp3', mp3: { mode: 'cbr', bitrate: 320, quality: 0 } };
  return [wav, theatre, mp3].map((settings, i) => ({ id: newId(), name: names[i]!, settings }));
}

export function createPresetStore(initial: readonly Preset[], persist: (presets: readonly Preset[]) => void): PresetStore {
  const list = signal<readonly Preset[]>(initial);
  const set = (next: readonly Preset[]) => {
    list.value = next;
    persist(next);
  };
  const clean = (name: string) => name.trim().slice(0, 100);
  return {
    list,
    add(name, settings) {
      const preset = { id: newId(), name: clean(name) || '—', settings: structuredClone(settings) };
      set([...list.value, preset]);
      return preset;
    },
    rename(id, name) {
      const n = clean(name);
      if (!n) return;
      set(list.value.map((p) => (p.id === id ? { ...p, name: n } : p)));
    },
    remove(id) {
      set(list.value.filter((p) => p.id !== id));
    },
    importText(text) {
      const parsed = parseDoc(PRESETS, text);
      if (!parsed.ok) return parsed;
      const ids = new Set(list.value.map((p) => p.id));
      const incoming = parsed.value.presets.map((p) => (ids.has(p.id) ? { ...p, id: newId() } : p));
      set([...list.value, ...incoming]);
      return { ok: true, added: incoming.length };
    },
    exportText(ids) {
      const chosen = ids ? list.value.filter((p) => ids.includes(p.id)) : list.value;
      return JSON.stringify(serializeDoc(PRESETS, { presets: [...chosen] }), null, 2);
    },
  };
}
