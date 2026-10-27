// The mix as a generic timeline: clips that point to files, and a transition into each clip after
// the first. Audio uses acrossfade; video will use xfade on the same structure.

import * as v from 'valibot';
import { clockTime } from './media.ts';
import { CurveSchema, FadeSchema } from './settings.ts';

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));

export const TransitionSchema = v.object({
  duration: seconds,
  curve: CurveSchema,
  /** Dry cut: the next clip starts where this one ends, ignoring the duration. */
  cut: v.boolean(),
});
export type Transition = v.InferOutput<typeof TransitionSchema>;

export const ClipSchema = v.object({
  id: v.string(),
  fileId: v.string(),
  kind: v.picklist(['audio', 'video']),
  /** Transition from the previous clip; null takes the mix default. Ignored on the first clip. */
  transitionIn: v.optional(v.nullable(TransitionSchema), null),
});
export type Clip = v.InferOutput<typeof ClipSchema>;

export const MixSettingsSchema = v.object({
  transition: v.optional(TransitionSchema, { duration: 6, curve: 'tri', cut: false }),
  fadeIn: v.optional(FadeSchema, { duration: 0, curve: 'tri' }),
  fadeOut: v.optional(FadeSchema, { duration: 0, curve: 'tri' }),
  matchLoudness: v.optional(v.boolean(), false),
  /** Integrated loudness every clip is brought to when `matchLoudness` is on. */
  matchLufs: v.optional(v.pipe(v.number(), v.minValue(-40), v.maxValue(-5)), -14),
  format: v.optional(v.picklist(['wav', 'mp3']), 'wav'),
  sampleRate: v.optional(v.picklist([44100, 48000]), 44100),
});
export type MixSettings = v.InferOutput<typeof MixSettingsSchema>;

export const defaultMix = (): MixSettings => v.parse(MixSettingsSchema, {});

export const transitionOf = (clip: Clip, mix: MixSettings): Transition => clip.transitionIn ?? mix.transition;

/** Overlap with the previous clip, in seconds; 0 for a dry cut. */
export const overlapOf = (clip: Clip, mix: MixSettings): number => {
  const t = transitionOf(clip, mix);
  return t.cut ? 0 : t.duration;
};

export interface Placed {
  clipId: string;
  start: number;
  end: number;
  overlapIn: number;
}

export type TimelineIssue =
  | { code: 'missing-length'; clipId: string }
  | { code: 'overlap-too-long'; clipId: string; max: number };

export interface Layout {
  placed: Placed[];
  duration: number;
  issues: TimelineIssue[];
}

/**
 * Where each clip sits in the mix. `lengths` is each clip's kept length. A chained crossfade eats
 * the tail of one clip and the head of the next, so a clip must be at least as long as the overlap
 * with its neighbours on both sides; overlaps that do not fit are reported and shortened.
 */
export function layout(clips: readonly Clip[], lengths: ReadonlyMap<string, number>, mix: MixSettings): Layout {
  const issues: TimelineIssue[] = [];
  const placed: Placed[] = [];
  let cursor = 0;
  let prevLength = 0;
  let prevOverlapIn = 0;
  clips.forEach((clip, i) => {
    const length = lengths.get(clip.id);
    if (length === undefined) issues.push({ code: 'missing-length', clipId: clip.id });
    const len = length ?? 0;
    let overlap = i === 0 ? 0 : overlapOf(clip, mix);
    const max = Math.max(0, Math.min(prevLength - prevOverlapIn, len));
    if (overlap > max) {
      issues.push({ code: 'overlap-too-long', clipId: clip.id, max });
      overlap = max;
    }
    const start = Math.max(0, cursor - overlap);
    placed.push({ clipId: clip.id, start, end: start + len, overlapIn: overlap });
    cursor = start + len;
    prevLength = len;
    prevOverlapIn = overlap;
  });
  return { placed, duration: cursor, issues };
}

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Start time of each clip, for the CSV export. */
export function timesCsv(placed: readonly Placed[], titleOf: (clipId: string) => string): string {
  const rows = placed.map((p, i) => [String(i + 1), clockTime(p.start), csvField(titleOf(p.clipId))].join(','));
  return ['n,start,title', ...rows].join('\n') + '\n';
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item as T);
  return out;
}
