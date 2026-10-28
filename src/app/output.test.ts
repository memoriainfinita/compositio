import { describe, expect, it } from 'vitest';
import type { JobView } from '../engine/index.ts';
import { media } from '../model/fixtures.ts';
import { PRESETS, serializeDoc } from '../model/formats.ts';
import { addFiles, emptyProject, setBatch, setOwn } from '../model/project.ts';
import { createStore } from '../model/store.ts';
import { createFiles } from './files.ts';
import { batchSettings, download, finished, prepare, processable, run, summarize } from './output.ts';
import { createPresetStore, starterPresets } from './presets.ts';

function setup(names: string[]) {
  let p = addFiles(emptyProject(), names.map((name, i) => ({ id: `f${i}`, name, size: 1, duration: 120 })));
  const store = createStore(p);
  const files = createFiles(store);
  files.sources.value = new Map(names.map((name, i) => [`f${i}`, new File(['x'], name)]));
  files.infos.value = new Map(names.map((_, i) => [`f${i}`, media()]));
  files.selected.value = new Set(names.map((_, i) => `f${i}`));
  p = store.get();
  return { p, files };
}

describe('output', () => {
  it('takes the selected files that are here, in list order', () => {
    const { p, files } = setup(['a.wav', 'b.wav', 'c.wav']);
    files.selected.value = new Set(['f2', 'f0']);
    files.sources.value = new Map([...files.sources.value].filter(([id]) => id !== 'f2'));
    expect(processable(p, files)).toEqual({ ids: ['f0'], active: false });
  });

  it('takes the file in the editor when none is checked, if it is here', () => {
    const { p, files } = setup(['a.wav', 'b.wav']);
    files.selected.value = new Set();
    expect(processable(p, files)).toEqual({ ids: [], active: false });
    files.active.value = 'f1';
    expect(processable(p, files)).toEqual({ ids: ['f1'], active: true });
    files.sources.value = new Map([...files.sources.value].filter(([id]) => id !== 'f1'));
    expect(processable(p, files)).toEqual({ ids: [], active: false });
  });

  it('names the batch with the pattern and tells colliding names apart', () => {
    const { p, files } = setup(['canción.wav', 'canción.flac', 'otra.wav']);
    const q = setBatch(p, 'output', { pattern: '{n} - {name}' });
    const r = prepare(q, files, ['f0', 'f1', 'f2'], batchSettings(q));
    expect(r.items.map((i) => i.name)).toEqual(['01 - canción.wav', '02 - canción.wav', '03 - otra.wav']);
    const same = prepare(p, files, ['f0', 'f1'], batchSettings(p));
    expect(same.items.map((i) => i.name)).toEqual(['canción.wav', 'canción (2).wav']);
  });

  it('uses each file’s own values on top of the batch', () => {
    const { p, files } = setup(['a.wav', 'b.wav']);
    const q = setOwn(p, 'f1', 'convert', { format: 'mp3' });
    const r = prepare(q, files, ['f0', 'f1'], batchSettings(q));
    expect(r.items.map((i) => i.name)).toEqual(['a.wav', 'b.mp3']);
  });

  it('leaves out what the plan refuses', () => {
    const { p, files } = setup(['a.wav']);
    files.infos.value = new Map([['f0', media({ tracks: [] })]]);
    expect(prepare(p, files, ['f0'], batchSettings(p))).toMatchObject({ items: [], refused: [{ id: 'f0', error: 'no-audio-track' }] });
  });

  it('saves nothing by itself and gives the jobs that worked', async () => {
    const { p, files } = setup(['a.wav', 'b.wav']);
    const engine = {
      process: (label: string) => ({ id: `job-${label}`, result: label.startsWith('b') ? Promise.reject(new Error('x')) : Promise.resolve({ blob: new Blob(['ok']), extension: 'wav', warnings: [], measurement: null }) }),
    };
    const items = prepare(p, files, ['f0', 'f1'], batchSettings(p)).items;
    expect(await run(engine, files, p, items)).toEqual(['job-a.wav']);
  });

  it('downloads one as itself, several file by file or as one zip', async () => {
    const saved: { name: string; blob: Blob }[] = [];
    const saver = (name: string, blob: Blob) => saved.push({ name, blob });
    const a = { name: 'a.wav', blob: new Blob(['a']) };
    const b = { name: 'b.wav', blob: new Blob(['b']) };
    await download([a], 'show.zip', true, saver);
    await download([a, b], 'show.zip', false, saver);
    await download([a, b], 'show.zip', true, saver);
    expect(saved.map((s) => s.name)).toEqual(['a.wav', 'a.wav', 'b.wav', 'show.zip']);
    expect(new TextDecoder().decode(new Uint8Array(await saved[3]!.blob.arrayBuffer()).slice(0, 2))).toBe('PK');
  });

  it('sums up only the user’s jobs', () => {
    const job = (status: JobView['status'], progress: number, priority: JobView['priority'] = 'user'): JobView => ({ id: 'j', label: 'x', priority, status, progress });
    expect(summarize([job('done', 1), job('running', 0.5), job('failed', 0), job('queued', 0, 'background')])).toEqual({
      total: 3,
      done: 1,
      failed: 1,
      active: 1,
      progress: 0.5,
    });
    const blob = new Blob(['x']);
    expect(finished([{ ...job('done', 1), label: 'a.wav', result: { blob } }, job('running', 0.2)])).toEqual([{ id: 'j', name: 'a.wav', blob }]);
  });
});

describe('presets', () => {
  it('starts with three starters and keeps every change', () => {
    const saved: number[] = [];
    const s = createPresetStore(starterPresets(['WAV', 'Teatro', 'MP3']), (l) => saved.push(l.length));
    expect(s.list.value.map((p) => p.settings.convert.format)).toEqual(['wav', 'wav', 'mp3']);
    expect(s.list.value[1]!.settings.normalize).toMatchObject({ enabled: true, lufs: -14 });
    const added = s.add('  Radio  ', s.list.value[2]!.settings);
    expect(added.name).toBe('Radio');
    s.rename(added.id, 'Podcast');
    s.rename(added.id, '   ');
    s.remove(s.list.value[0]!.id);
    expect(s.list.value.map((p) => p.name)).toEqual(['Teatro', 'MP3', 'Podcast']);
    expect(saved).toEqual([4, 4, 3]);
  });

  it('exports and imports, with new ids for those already present', () => {
    const s = createPresetStore(starterPresets(['WAV', 'Teatro', 'MP3']), () => {});
    const text = s.exportText([s.list.value[0]!.id]);
    expect(JSON.parse(text)).toMatchObject({ format: 'compositio.presets', version: 1 });
    expect(s.importText(text)).toEqual({ ok: true, added: 1 });
    const ids = s.list.value.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('refuses a newer version or another format', () => {
    const s = createPresetStore([], () => {});
    const newer = JSON.stringify({ ...serializeDoc(PRESETS, { presets: [] }), version: 99 });
    expect(s.importText(newer)).toEqual({ ok: false, error: { code: 'too-new', version: 99 } });
    expect(s.importText('{"format":"other","version":1}')).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
    expect(s.importText('nope')).toMatchObject({ ok: false, error: { code: 'not-json' } });
  });
});
