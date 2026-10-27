import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { MONTAGE, PRESETS, parseDoc, serializeDoc, type FormatDef } from './formats.ts';
import { addClips, addFiles, emptyProject, setEdits } from './project.ts';
import { defaultSettings } from './settings.ts';

describe('montage format', () => {
  it('round-trips through JSON', () => {
    let p = addFiles(emptyProject(), [{ id: 'f1', name: 'uno.wav', size: 100, duration: 60 }]);
    p = setEdits(p, 'f1', { in: 2 });
    p = addClips(p, ['f1']);
    const json = JSON.stringify(serializeDoc(MONTAGE, p));
    expect(JSON.parse(json)).toMatchObject({ format: 'compositio.montage', version: 1 });
    expect(parseDoc(MONTAGE, json)).toEqual({ ok: true, value: p, migratedFrom: null });
  });

  it('fills defaults for what an older writer left out', () => {
    const r = parseDoc(MONTAGE, { format: 'compositio.montage', version: 1, files: [] });
    expect(r.ok && r.value.batch).toEqual(defaultSettings());
  });

  it('refuses what it cannot read, saying why', () => {
    expect(parseDoc(MONTAGE, '{nope')).toEqual({ ok: false, error: { code: 'not-json' } });
    expect(parseDoc(MONTAGE, { format: 'compositio.presets', version: 1 })).toEqual({ ok: false, error: { code: 'wrong-format', found: 'compositio.presets' } });
    expect(parseDoc(MONTAGE, { format: 'compositio.montage', version: 2, files: [] })).toEqual({ ok: false, error: { code: 'too-new', version: 2 } });
    expect(parseDoc(MONTAGE, { format: 'compositio.montage', version: '1', files: [] })).toEqual({ ok: false, error: { code: 'bad-version', found: '1' } });
  });

  it('points to the invalid field', () => {
    const r = parseDoc(MONTAGE, { format: 'compositio.montage', version: 1, files: [{ id: 'a', name: 'x', size: -1, duration: null }] });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === 'invalid') expect(r.error.issues[0]?.path).toBe('files.0.size');
  });

  it('refuses clips that point to no file', () => {
    const doc = { format: 'compositio.montage', version: 1, files: [], clips: [{ id: 'c', fileId: 'ghost', kind: 'audio' }] };
    expect(parseDoc(MONTAGE, doc).ok).toBe(false);
  });
});

describe('migrations', () => {
  const def: FormatDef<{ title: string; gain: number }> = {
    format: 'test.doc',
    version: 3,
    schema: v.object({ title: v.string(), gain: v.number() }),
    migrations: {
      1: ({ name, ...rest }) => ({ ...rest, title: name }),
      2: (body) => ({ ...body, gain: 0 }),
    },
  };

  it('migrates step by step to the current version', () => {
    expect(parseDoc(def, { format: 'test.doc', version: 1, name: 'old' })).toEqual({ ok: true, value: { title: 'old', gain: 0 }, migratedFrom: 1 });
    expect(parseDoc(def, { format: 'test.doc', version: 2, title: 't' })).toEqual({ ok: true, value: { title: 't', gain: 0 }, migratedFrom: 2 });
  });
});

describe('presets format', () => {
  it('reads an exported preset file', () => {
    const file = serializeDoc(PRESETS, { presets: [{ id: 'p', name: 'Teatro', settings: defaultSettings() }] });
    const r = parseDoc(PRESETS, JSON.stringify(file));
    expect(r.ok && r.value.presets[0]?.name).toBe('Teatro');
  });
});
