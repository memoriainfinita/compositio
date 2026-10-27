// What the user edited on a file. It belongs to the file: in, out and fades count the same when
// the file is processed alone or inside the mix.

import * as v from 'valibot';
import { FadeSchema, OverridesSchema, type Fade } from './settings.ts';

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));

export const FileEditsSchema = v.object({
  in: v.optional(seconds, 0),
  /** null: up to the end of the file. */
  out: v.optional(v.nullable(seconds), null),
  fadeIn: v.optional(FadeSchema, { duration: 0, curve: 'tri' }),
  fadeOut: v.optional(FadeSchema, { duration: 0, curve: 'tri' }),
  own: v.optional(OverridesSchema, {}),
});
export type FileEdits = v.InferOutput<typeof FileEditsSchema>;

export const defaultEdits = (): FileEdits => v.parse(FileEditsSchema, {});

/** Silences found at the ends (-60 dBFS). Computed, never set by the user, so outside undo. */
export interface Silences {
  /** End of the leading silence; 0 when the file starts with sound. */
  head: number;
  /** Start of the trailing silence; the duration when it ends with sound. */
  tail: number;
}

export interface Range {
  start: number;
  end: number;
}

export const rangeLength = (r: Range): number => Math.max(0, r.end - r.start);

/** The part of the file that is kept, given its duration and, if applied, its silences. */
export function keptRange(edits: FileEdits, duration: number, silences?: Silences | null): Range {
  let start = Math.min(edits.in, duration);
  let end = Math.min(edits.out ?? duration, duration);
  if (silences) {
    start = Math.max(start, silences.head);
    end = Math.min(end, silences.tail);
  }
  return end > start ? { start, end } : { start, end: start };
}

export type EditIssue = 'empty-range' | 'out-before-in' | 'fades-too-long';

export function editIssues(edits: FileEdits, duration: number, silences?: Silences | null): EditIssue[] {
  const issues: EditIssue[] = [];
  if (edits.out !== null && edits.out <= edits.in) issues.push('out-before-in');
  const length = rangeLength(keptRange(edits, duration, silences));
  if (length === 0) issues.push('empty-range');
  else if (edits.fadeIn.duration + edits.fadeOut.duration > length) issues.push('fades-too-long');
  return issues;
}

/** Fades shortened in proportion so that both fit in the kept length. */
export function fittedFades(edits: FileEdits, length: number): { fadeIn: Fade; fadeOut: Fade } {
  const total = edits.fadeIn.duration + edits.fadeOut.duration;
  const k = total > length && total > 0 ? length / total : 1;
  return {
    fadeIn: { ...edits.fadeIn, duration: edits.fadeIn.duration * k },
    fadeOut: { ...edits.fadeOut, duration: edits.fadeOut.duration * k },
  };
}
