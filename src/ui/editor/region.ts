// What dragging, typing or nudging does to a file's in, out and fades: always a valid region,
// never a fade longer than what is left of it. Each returns the patch for `setEdits`.

import type { FileEdits } from '../../model/edits.ts';

/** The shortest region a file can be cut to, in seconds. */
export const MIN_LENGTH = 0.01;

type Patch = Partial<Omit<FileEdits, 'own'>>;

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), Math.max(lo, hi));
const outOf = (e: FileEdits, duration: number): number => Math.min(e.out ?? duration, duration);
/** Out at the very end is stored as null: «up to the end», whatever the file measures. */
const storeOut = (t: number, duration: number): number | null => (t >= duration - 1e-6 ? null : t);

/** Fades shortened to fit a new length, the fade out first, as it is the one nearest the edit. */
function fitFades(e: FileEdits, length: number): Patch {
  const fadeIn = Math.min(e.fadeIn.duration, length);
  const fadeOut = Math.min(e.fadeOut.duration, length - fadeIn);
  const patch: Patch = {};
  if (fadeIn !== e.fadeIn.duration) patch.fadeIn = { ...e.fadeIn, duration: fadeIn };
  if (fadeOut !== e.fadeOut.duration) patch.fadeOut = { ...e.fadeOut, duration: fadeOut };
  return patch;
}

export function setIn(e: FileEdits, duration: number, t: number): Patch {
  const out = outOf(e, duration);
  const at = clamp(t, 0, out - MIN_LENGTH);
  return { in: at, ...fitFades(e, out - at) };
}

export function setOut(e: FileEdits, duration: number, t: number): Patch {
  const at = clamp(t, e.in + MIN_LENGTH, duration);
  return { out: storeOut(at, duration), ...fitFades(e, at - e.in) };
}

/** Moves the whole region, its length kept, inside the file. */
export function moveRegion(e: FileEdits, duration: number, start: number): Patch {
  const length = outOf(e, duration) - e.in;
  const at = clamp(start, 0, duration - length);
  return { in: at, out: storeOut(at + length, duration) };
}

export function setFadeIn(e: FileEdits, duration: number, seconds: number): Patch {
  const room = outOf(e, duration) - e.in - e.fadeOut.duration;
  return { fadeIn: { ...e.fadeIn, duration: clamp(seconds, 0, room) } };
}

export function setFadeOut(e: FileEdits, duration: number, seconds: number): Patch {
  const room = outOf(e, duration) - e.in - e.fadeIn.duration;
  return { fadeOut: { ...e.fadeOut, duration: clamp(seconds, 0, room) } };
}

export const regionOut = outOf;
