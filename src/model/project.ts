// The work in progress is a montage: files with their edits, the mix and the batch settings. What
// is undoable lives here. The File objects, media info, detected silences and selection belong to
// the session and are not saved or undone.

import { defaultEdits, type FileEdits } from './edits.ts';
import type { FileRef, Montage } from './formats.ts';
import { defaultSettings, pruneOverrides, type OutputSettings, type Overrides, type Step } from './settings.ts';
import { defaultMix, moveItem, type Clip, type MixSettings, type Transition } from './timeline.ts';

export type Project = Montage;

export const newId = (): string => crypto.randomUUID();

export const emptyProject = (): Project => ({
  id: null,
  name: '',
  files: [],
  clips: [],
  mix: defaultMix(),
  batch: defaultSettings(),
});

/** Returns the same object when nothing changes, so history records nothing. */
function updateFile(p: Project, fileId: string, fn: (f: FileRef) => FileRef): Project {
  let changed = false;
  const files = p.files.map((f) => {
    if (f.id !== fileId) return f;
    const next = fn(f);
    changed ||= next !== f;
    return next;
  });
  return changed ? { ...p, files } : p;
}

export type NewFile = Pick<FileRef, 'name' | 'size' | 'duration'> & { id?: string };

export function addFiles(p: Project, added: readonly NewFile[]): Project {
  if (added.length === 0) return p;
  const files = added.map((f) => ({ id: f.id ?? newId(), name: f.name, size: f.size, duration: f.duration, edits: defaultEdits() }));
  return { ...p, files: [...p.files, ...files] };
}

export function removeFiles(p: Project, ids: readonly string[]): Project {
  const gone = new Set(ids);
  if (!p.files.some((f) => gone.has(f.id))) return p;
  return { ...p, files: p.files.filter((f) => !gone.has(f.id)), clips: p.clips.filter((c) => !gone.has(c.fileId)) };
}

export function moveFile(p: Project, from: number, to: number): Project {
  return from === to ? p : { ...p, files: moveItem(p.files, from, to) };
}

export function setEdits(p: Project, fileId: string, patch: Partial<Omit<FileEdits, 'own'>>): Project {
  return updateFile(p, fileId, (f) => {
    const edits = { ...f.edits, ...patch };
    return JSON.stringify(edits) === JSON.stringify(f.edits) ? f : { ...f, edits };
  });
}

/** Sets a file's own values for one step; values equal to the batch are dropped. */
export function setOwn<S extends Step>(p: Project, fileId: string, step: S, values: NonNullable<Overrides[S]>): Project {
  return updateFile(p, fileId, (f) => {
    const merged = { ...f.edits.own, [step]: { ...f.edits.own[step], ...values } } as Overrides;
    const own = pruneOverrides(p.batch, merged);
    return JSON.stringify(own) === JSON.stringify(f.edits.own) ? f : { ...f, edits: { ...f.edits, own } };
  });
}

export function clearOwn(p: Project, fileId: string): Project {
  return updateFile(p, fileId, (f) => (Object.keys(f.edits.own).length ? { ...f, edits: { ...f.edits, own: {} } } : f));
}

export function setBatch<S extends Step>(p: Project, step: S, values: Partial<OutputSettings[S]>): Project {
  const section = { ...p.batch[step], ...values };
  if (JSON.stringify(section) === JSON.stringify(p.batch[step])) return p;
  return { ...p, batch: { ...p.batch, [step]: section } };
}

export const applyPreset = (p: Project, settings: OutputSettings): Project => ({ ...p, batch: structuredClone(settings) });

/** `at`: where the new clips go in the mix; at the end when left out. */
export function addClips(p: Project, fileIds: readonly string[], kindOf: (fileId: string) => Clip['kind'] = () => 'audio', at = p.clips.length): Project {
  const known = new Set(p.files.map((f) => f.id));
  const clips = fileIds.filter((id) => known.has(id)).map((fileId) => ({ id: newId(), fileId, kind: kindOf(fileId), transitionIn: null }));
  return clips.length ? { ...p, clips: [...p.clips.slice(0, at), ...clips, ...p.clips.slice(at)] } : p;
}

export function removeClip(p: Project, clipId: string): Project {
  return p.clips.some((c) => c.id === clipId) ? { ...p, clips: p.clips.filter((c) => c.id !== clipId) } : p;
}

export function moveClip(p: Project, from: number, to: number): Project {
  return from === to ? p : { ...p, clips: moveItem(p.clips, from, to) };
}

/** null goes back to the mix default. */
export function setTransition(p: Project, clipId: string, transitionIn: Transition | null): Project {
  let changed = false;
  const clips = p.clips.map((c) => {
    if (c.id !== clipId || JSON.stringify(c.transitionIn) === JSON.stringify(transitionIn)) return c;
    changed = true;
    return { ...c, transitionIn };
  });
  return changed ? { ...p, clips } : p;
}

export function setMix(p: Project, values: Partial<MixSettings>): Project {
  const mix = { ...p.mix, ...values };
  return JSON.stringify(mix) === JSON.stringify(p.mix) ? p : { ...p, mix };
}

export const rename = (p: Project, name: string): Project => (name === p.name ? p : { ...p, name });

/** After saving: the name it was saved with and the id of the saved montage. */
export const markSaved = (p: Project, id: string, name: string): Project => (p.id === id && p.name === name ? p : { ...p, id, name });

export interface Candidate {
  name: string;
  size: number;
}

/**
 * Pairs the files of a reopened montage with the files the user adds: same name and size first,
 * then the same name alone when only one candidate has it. Unpaired files are missing.
 */
export function pairFiles(refs: readonly FileRef[], candidates: readonly Candidate[]): Map<string, number> {
  const pairs = new Map<string, number>();
  const used = new Set<number>();
  for (const ref of refs) {
    const i = candidates.findIndex((c, k) => !used.has(k) && c.name === ref.name && c.size === ref.size);
    if (i >= 0) {
      pairs.set(ref.id, i);
      used.add(i);
    }
  }
  for (const ref of refs) {
    if (pairs.has(ref.id)) continue;
    const name = ref.name.toLowerCase();
    const matches = candidates.flatMap((c, k) => (!used.has(k) && c.name.toLowerCase() === name ? [k] : []));
    if (matches.length === 1) {
      pairs.set(ref.id, matches[0] as number);
      used.add(matches[0] as number);
    }
  }
  return pairs;
}
