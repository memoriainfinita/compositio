import { describe, expect, it } from 'vitest';
import {
  addClips,
  addFiles,
  clearOwn,
  emptyProject,
  moveClip,
  pairFiles,
  removeFiles,
  setBatch,
  setEdits,
  setMix,
  setOwn,
  setTransition,
  type Project,
} from './project.ts';
import { createStore } from './store.ts';
import { hasOverrides } from './settings.ts';

const withFiles = (): Project =>
  addFiles(emptyProject(), [
    { id: 'a', name: 'a.wav', size: 10, duration: 60 },
    { id: 'b', name: 'b.wav', size: 20, duration: 30 },
  ]);

describe('project commands', () => {
  it('return the same project when nothing changes', () => {
    const p = withFiles();
    expect(setEdits(p, 'a', { in: 0 })).toBe(p);
    expect(setEdits(p, 'missing', { in: 3 })).toBe(p);
    expect(setBatch(p, 'convert', { format: 'wav' })).toBe(p);
    expect(setMix(p, { sampleRate: 44100 })).toBe(p);
    expect(moveClip(p, 0, 0)).toBe(p);
    expect(removeFiles(p, ['none'])).toBe(p);
  });

  it('never mutate the previous project', () => {
    const p = withFiles();
    const frozen = JSON.stringify(p);
    setEdits(p, 'a', { in: 3 });
    setBatch(p, 'normalize', { enabled: true });
    addClips(p, ['a']);
    expect(JSON.stringify(p)).toBe(frozen);
  });

  it('drop the clips of removed files', () => {
    const p = addClips(withFiles(), ['a', 'b', 'a']);
    const r = removeFiles(p, ['a']);
    expect(r.files.map((f) => f.id)).toEqual(['b']);
    expect(r.clips.map((c) => c.fileId)).toEqual(['b']);
  });

  it('keep only own values that differ from the batch', () => {
    let p = setOwn(withFiles(), 'a', 'convert', { format: 'wav' });
    expect(p.files[0]?.edits.own).toEqual({});
    p = setOwn(p, 'a', 'convert', { format: 'mp3' });
    expect(hasOverrides(p.batch, p.files[0]!.edits.own)).toBe(true);
    expect(clearOwn(p, 'a').files[0]?.edits.own).toEqual({});
  });

  it('set and reset a clip transition', () => {
    const p = addClips(withFiles(), ['a', 'b']);
    const id = p.clips[1]!.id;
    const t = { duration: 3, curve: 'qsin' as const, cut: false };
    const q = setTransition(p, id, t);
    expect(q.clips[1]?.transitionIn).toEqual(t);
    expect(setTransition(q, id, t)).toBe(q);
    expect(setTransition(q, id, null).clips[1]?.transitionIn).toBeNull();
  });
});

describe('pairFiles', () => {
  it('pairs by name and size, then by a unique name', () => {
    const refs = [
      { id: '1', name: 'Uno.wav', size: 10, duration: null, edits: {} as never },
      { id: '2', name: 'dos.wav', size: 20, duration: null, edits: {} as never },
      { id: '3', name: 'tres.wav', size: 30, duration: null, edits: {} as never },
    ];
    const pairs = pairFiles(refs, [
      { name: 'dos.wav', size: 20 },
      { name: 'uno.wav', size: 99 },
      { name: 'otro.wav', size: 30 },
    ]);
    expect([...pairs]).toEqual([
      ['2', 0],
      ['1', 1],
    ]);
  });
});

describe('store', () => {
  it('undoes and redoes, and a new change clears redo', () => {
    const s = createStore(withFiles());
    s.run((p) => setEdits(p, 'a', { in: 1 }));
    s.run((p) => setEdits(p, 'a', { in: 2 }));
    s.undo();
    expect(s.get().files[0]?.edits.in).toBe(1);
    s.redo();
    expect(s.get().files[0]?.edits.in).toBe(2);
    s.undo();
    s.run((p) => setEdits(p, 'b', { in: 5 }));
    expect(s.canRedo()).toBe(false);
    s.undo();
    s.undo();
    expect(s.get().files[0]?.edits.in).toBe(0);
    expect(s.canUndo()).toBe(false);
  });

  it('merges the steps of one drag into a single undo', () => {
    let t = 0;
    const s = createStore(withFiles(), () => t);
    for (const x of [1, 2, 3, 4]) {
      t += 100;
      s.run((p) => setEdits(p, 'a', { in: x }), 'drag-in-a');
    }
    t += 5000;
    s.run((p) => setEdits(p, 'a', { in: 9 }), 'drag-in-a');
    s.undo();
    expect(s.get().files[0]?.edits.in).toBe(4);
    s.undo();
    expect(s.get().files[0]?.edits.in).toBe(0);
  });

  it('records nothing and tells nobody when a command changes nothing', () => {
    const s = createStore(withFiles());
    let calls = 0;
    s.subscribe(() => calls++);
    s.run((p) => setEdits(p, 'a', { in: 0 }));
    expect(s.canUndo()).toBe(false);
    expect(calls).toBe(0);
    s.run((p) => setEdits(p, 'a', { in: 1 }));
    expect(calls).toBe(1);
  });

  it('keeps at most 200 steps', () => {
    const s = createStore(withFiles());
    for (let i = 1; i <= 250; i++) s.run((p) => setEdits(p, 'a', { in: i }));
    let n = 0;
    while (s.canUndo()) {
      s.undo();
      n++;
    }
    expect(n).toBe(200);
    expect(s.get().files[0]?.edits.in).toBe(50);
  });
});
