// The mix as the interface sees it: its clips with what the session knows of their files, whether
// it can be generated, and the jobs that generate it or let one transition be heard.

import { signal } from '@preact/signals';
import type { Engine, MixInput } from '../engine/index.ts';
import type { Measurement } from '../model/operations.ts';
import { keptRange, rangeLength } from '../model/edits.ts';
import { lengthsOf, matchGain, measureKeyOf, sourceOf, wavBytes, WAV_MEMORY_LIMIT, type MixClip } from '../model/mix.ts';
import { stem } from '../model/naming.ts';
import type { Project } from '../model/project.ts';
import { effectiveSettings } from '../model/settings.ts';
import { layout, timesCsv, type Layout, type MixSettings, type Transition } from '../model/timeline.ts';
import type { Files } from './files.ts';
import { save, type Saver } from './output.ts';

/** Loudness measured for matching, by `measureKeyOf`; it outlives a single mix. */
const measured = new WeakMap<Files, Map<string, Measurement>>();
const measuredFor = (files: Files): Map<string, Measurement> => {
  const m = measured.get(files) ?? new Map<string, Measurement>();
  measured.set(files, m);
  return m;
};

/** The clips whose file is here and probed, with the File, in mix order. */
export function mixClips(project: Project, files: Files): { clips: MixClip[]; files: File[]; missing: string[] } {
  const clips: MixClip[] = [];
  const sources: File[] = [];
  const missing: string[] = [];
  for (const clip of project.clips) {
    const ref = project.files.find((f) => f.id === clip.fileId);
    const file = files.sources.value.get(clip.fileId);
    const info = files.infos.value.get(clip.fileId);
    if (!ref || !file || !info) {
      missing.push(clip.id);
      continue;
    }
    clips.push({ clip, info, edits: ref.edits, settings: effectiveSettings(project.batch, ref.edits.own), silences: files.silences.value.get(clip.fileId) ?? null });
    sources.push(file);
  }
  return { clips, files: sources, missing };
}

/**
 * Lengths for the strip: the clips here are measured from their file; a missing one keeps the
 * duration saved with the montage, so the strip still shows where it would go. Without `files`,
 * every clip takes its saved duration, as a saved montage in the library.
 */
export function stripLayout(project: Project, files?: Files): Layout {
  const lengths = files ? lengthsOf(mixClips(project, files).clips) : new Map<string, number>();
  for (const c of project.clips) {
    if (lengths.has(c.id)) continue;
    const ref = project.files.find((f) => f.id === c.fileId);
    if (ref && ref.duration !== null) lengths.set(c.id, rangeLength(keptRange(ref.edits, ref.duration)));
  }
  return layout(project.clips, lengths, project.mix);
}

export type Blocker = 'empty' | 'missing' | 'no-engine';

export function blocker(project: Project, files: Files, engine: Engine | null): Blocker | null {
  if (project.clips.length === 0) return 'empty';
  if (mixClips(project, files).missing.length) return 'missing';
  return engine ? null : 'no-engine';
}

/** The WAV mix's size when it may not fit in memory; null otherwise. */
export function memoryRisk(mix: MixSettings, duration: number): number | null {
  if (mix.format !== 'wav') return null;
  const bytes = wavBytes(duration, mix.sampleRate);
  return bytes > WAV_MEMORY_LIMIT ? bytes : null;
}

export const mixName = (project: Project, extension: string): string => `${stem(project.name.trim()) || 'mezcla'}.${extension}`;

const input = (project: Project, files: Files): MixInput => {
  const m = mixClips(project, files);
  return { clips: m.clips, files: m.files, mix: project.mix, measured: measuredFor(files) };
};

/** Queues the mix; it downloads by itself when done. */
export function generate(engine: Pick<Engine, 'mix'>, project: Project, files: Files, saver: Saver = save): { id: string; name: string } {
  const name = mixName(project, project.mix.format);
  const { id, result } = engine.mix(name, input(project, files));
  result.then((r) => saver(name, r.blob), () => {});
  return { id, name };
}

/** The transition into the clip at `index`, with a draft in place of the saved one. */
export function preview(engine: Pick<Engine, 'preview'>, project: Project, files: Files, index: number, transition: Transition) {
  const all = input(project, files);
  const at = all.clips.findIndex((c) => c.clip.id === project.clips[index]?.id);
  if (at < 1) return null;
  return engine.preview({ ...all, clips: all.clips.slice(at - 1, at + 1), files: all.files.slice(at - 1, at + 1), transition });
}

/** Bumped when a measurement for listening lands, so the mix's gains are read again. */
const measuredTick = signal(0);
const asking = new WeakMap<Files, Set<string>>();

/**
 * Matching's gains by clip id in dB for listening to the mix; null while some clip is not measured.
 * The first call for a set of clips asks the engine for what is missing.
 */
export function liveGains(engine: Pick<Engine, 'measureMix'> | null, project: Project, files: Files): Map<string, number> | null {
  void measuredTick.value;
  const all = input(project, files);
  const gains = new Map<string, number>();
  const missing: string[] = [];
  for (const c of all.clips) {
    const s = sourceOf(c);
    if ('error' in s) continue;
    const key = measureKeyOf(c.clip.fileId, s);
    const m = all.measured.get(key);
    if (m) gains.set(c.clip.id, matchGain(m, project.mix.matchLufs));
    else missing.push(key);
  }
  if (missing.length === 0) return gains;
  const asked = asking.get(files) ?? new Set<string>();
  asking.set(files, asked);
  const want = missing.join('|');
  if (engine && !asked.has(want)) {
    asked.add(want);
    engine.measureMix(all).then(
      () => measuredTick.value++,
      () => asked.delete(want),
    );
  }
  return null;
}

export function times(project: Project, layout: Layout): string {
  const title = (clipId: string): string => {
    const clip = project.clips.find((c) => c.id === clipId);
    return stem(project.files.find((f) => f.id === clip?.fileId)?.name ?? '');
  };
  return timesCsv(layout.placed, title);
}

export function saveTimes(project: Project, files: Files, saver: Saver = save): string {
  const name = mixName(project, 'csv');
  saver(name, new Blob([times(project, stripLayout(project, files))], { type: 'text/csv' }));
  return name;
}
