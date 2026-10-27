import { describe, expect, it } from 'vitest';
import { emptyProject, removeFiles } from '../model/project.ts';
import type { MediaInfo } from '../model/media.ts';
import { createStore } from '../model/store.ts';
import { defaultEdits } from '../model/edits.ts';
import { addIncoming, createFiles, selectAll, toggleSelected, type Analyzer } from './files.ts';

const audio = (duration: number): MediaInfo => ({
  container: 'wav',
  duration,
  tracks: [{ kind: 'audio', index: 0, codec: 'pcm_s16le', channels: 2, sampleRate: 48000, bitDepth: 16 }],
  tags: {},
  hasCover: false,
});
const clip = (duration: number): MediaInfo => ({
  ...audio(duration),
  tracks: [{ kind: 'video', index: 0, codec: 'h264', width: 640, height: 360, fps: { num: 25, den: 1 }, rotation: 0 }],
});

/** Probes by name: `*.mp4` is video, `broken*` fails, `empty*` has no tracks; durations from the name's digits. */
function fakeEngine(multithread = true): Analyzer & { probed: string[]; silenced: string[] } {
  const probed: string[] = [];
  const silenced: string[] = [];
  return {
    multithread,
    probed,
    silenced,
    async probe(file) {
      probed.push(file.name);
      if (file.name.startsWith('broken')) throw new Error('unreadable');
      if (file.name.startsWith('empty')) return { ...audio(1), tracks: [] };
      const seconds = Number(/\d+/.exec(file.name)?.[0] ?? 1);
      return file.name.endsWith('.mp4') ? clip(seconds) : audio(seconds);
    },
    async silences(file, info) {
      silenced.push(file.name);
      return { head: 0, tail: info.duration };
    },
  };
}

const f = (name: string, lastModified = 1) => new File([new Uint8Array(4)], name, { lastModified });
const batch = (...files: File[]) => files.map((file) => ({ file, path: file.name }));
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(initial = emptyProject()) {
  const store = createStore(initial);
  const files = createFiles(store);
  return { store, files };
}

describe('adding files', () => {
  it('adds a whole batch at once, in natural order, with durations, as one undo step', async () => {
    const { store, files } = setup();
    const engine = fakeEngine();
    const r = await addIncoming(store, files, engine, batch(f('20.wav'), f('3.wav'), f('100.wav')));
    expect(r).toMatchObject({ added: 3, paired: 0, duplicates: 0 });
    expect(r.ids).toEqual(store.get().files.map((x) => x.id));
    expect(store.get().files.map((x) => [x.name, x.duration])).toEqual([
      ['3.wav', 3],
      ['20.wav', 20],
      ['100.wav', 100],
    ]);
    const ids = store.get().files.map((x) => x.id);
    expect([...files.selected.value]).toEqual(ids);
    expect(files.active.value).toBe(ids[0]);
    expect(files.infos.value.get(ids[1]!)?.duration).toBe(20);
    expect(files.analyzing.value).toBeNull();
    await tick();
    expect(engine.silenced).toEqual(['3.wav', '20.wav', '100.wav']);
    expect(files.silences.value.size).toBe(3);

    store.undo();
    expect(store.get().files).toEqual([]);
    expect(files.selected.value.size).toBe(0);
    expect(files.active.value).toBeNull();
    store.redo();
    // The File objects stayed: the files come back whole.
    expect(store.get().files.every((x) => files.sources.value.has(x.id))).toBe(true);
  });

  it('counts the analysis across batches while it runs', async () => {
    const { store, files } = setup();
    const seen: (string | null)[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine = fakeEngine();
    const slow: Analyzer = { ...engine, probe: async (file) => (await gate, engine.probe(file)) };
    const first = addIncoming(store, files, slow, batch(f('1.wav'), f('2.wav')));
    const second = addIncoming(store, files, slow, batch(f('3.wav')));
    seen.push(JSON.stringify(files.analyzing.value));
    release();
    await Promise.all([first, second]);
    seen.push(JSON.stringify(files.analyzing.value));
    expect(seen).toEqual(['{"done":0,"total":3}', 'null']);
    expect(store.get().files).toHaveLength(3);
  });

  it('leaves out what is not media, unreadable or too big, and says which', async () => {
    const { store, files } = setup();
    const big = f('Ensayo general.mp4');
    Object.defineProperty(big, 'size', { value: 3.4 * 1024 ** 3 });
    await addIncoming(store, files, fakeEngine(), batch(f('ok.wav'), f('notas.txt'), f('broken.mp3'), f('empty.wav'), big));
    expect(store.get().files.map((x) => x.name)).toEqual(['ok.wav']);
    const alerts = files.alerts.value.map(({ id: _id, ...a }) => a);
    expect(alerts).toEqual([
      { kind: 'too-big', name: 'Ensayo general.mp4', size: 3.4 * 1024 ** 3 },
      { kind: 'not-media', names: ['notas.txt', 'broken.mp3', 'empty.wav'] },
    ]);
  });

  it('skips files already in the list, also when two drops overlap', async () => {
    const { store, files } = setup();
    const engine = fakeEngine();
    await addIncoming(store, files, engine, batch(f('a.wav')));
    const [r1, r2] = await Promise.all([addIncoming(store, files, engine, batch(f('a.wav'), f('b.wav'))), addIncoming(store, files, engine, batch(f('b.wav')))]);
    expect(r1.duplicates + r2.duplicates).toBe(2);
    expect(store.get().files.map((x) => x.name)).toEqual(['a.wav', 'b.wav']);
  });

  it('warns once about single-thread mode, and only for video', async () => {
    const { store, files } = setup();
    const engine = fakeEngine(false);
    await addIncoming(store, files, engine, batch(f('song.wav')));
    expect(files.alerts.value).toEqual([]);
    await addIncoming(store, files, engine, batch(f('a.mp4')));
    await addIncoming(store, files, engine, batch(f('b.mp4')));
    expect(files.alerts.value.map((a) => a.kind)).toEqual(['single-thread']);
    expect(engine.silenced).toEqual(['song.wav']);
  });

  it('pairs the missing files of a restored session without adding them', async () => {
    const restored = { ...emptyProject(), files: [{ id: 'x', name: 'Obertura.wav', size: 4, duration: 10, edits: defaultEdits() }] };
    const { store, files } = setup(restored);
    expect(files.selected.value.size).toBe(0);
    toggleSelected(files, 'x', true);
    expect(files.selected.value.size).toBe(0);

    const r = await addIncoming(store, files, fakeEngine(), batch(f('Obertura.wav'), f('Nueva.wav')));
    expect(r).toMatchObject({ added: 1, paired: 1, duplicates: 0 });
    expect(store.get().files.map((x) => x.id)[0]).toBe('x');
    expect(files.sources.value.get('x')?.name).toBe('Obertura.wav');
    expect(files.selected.value.has('x')).toBe(true);
  });

  it('selects all or none of what can be processed, and forgets removed files', async () => {
    const restored = { ...emptyProject(), files: [{ id: 'gone', name: 'Falta.wav', size: 9, duration: 1, edits: defaultEdits() }] };
    const { store, files } = setup(restored);
    await addIncoming(store, files, fakeEngine(), batch(f('a.wav'), f('b.wav')));
    selectAll(store, files, false);
    expect(files.selected.value.size).toBe(0);
    selectAll(store, files, true);
    expect(files.selected.value.size).toBe(2);
    expect(files.selected.value.has('gone')).toBe(false);

    const [a] = store.get().files.filter((x) => x.id !== 'gone');
    files.active.value = a!.id;
    store.run((p) => removeFiles(p, [a!.id]));
    expect(files.selected.value.size).toBe(1);
    expect(files.active.value).toBeNull();
  });
});
