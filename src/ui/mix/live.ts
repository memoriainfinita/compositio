// What the mix sounds like while it plays from the files: where each clip sits, the part of its
// file it reads, and its gain at any moment with the file's fades, the crossfades with acrossfade's
// curves, the matching gain and the mix's own fades. The sample rate and MP3 are not imitated.

import { fittedFades } from '../../model/edits.ts';
import { mixLayout, sourceOf, type MixClip } from '../../model/mix.ts';
import type { Curve, Fade } from '../../model/settings.ts';
import { transitionOf, type MixSettings } from '../../model/timeline.ts';
import { fadeGain } from '../editor/preview.ts';

export interface LiveClip {
  clipId: string;
  fileId: string;
  /** Where the clip starts in the mix, in seconds. */
  at: number;
  /** Where it reads from its file and for how long. */
  from: number;
  length: number;
  overlapIn: number;
  overlapOut: number;
  curveIn: Curve;
  curveOut: Curve;
  fadeIn: Fade;
  fadeOut: Fade;
  /** Linear gain of matching loudness; 1 when off or not measured. */
  gain: number;
}

export interface Live {
  clips: LiveClip[];
  duration: number;
  fadeIn: Fade;
  fadeOut: Fade;
}

/** `gains` by clip id in dB, as the mix uses them; null when matching is off or not measured. */
export function livePlan(clips: readonly MixClip[], mix: MixSettings, gains: ReadonlyMap<string, number> | null): Live {
  const lay = mixLayout(clips, mix);
  const out: LiveClip[] = [];
  clips.forEach((c, i) => {
    const s = sourceOf(c);
    const placed = lay.placed[i];
    if ('error' in s || !placed) return;
    const next = clips[i + 1];
    const db = mix.matchLoudness ? (gains?.get(c.clip.id) ?? 0) : 0;
    out.push({
      clipId: c.clip.id,
      fileId: c.clip.fileId,
      at: placed.start,
      from: s.start,
      length: s.length,
      overlapIn: placed.overlapIn,
      overlapOut: lay.placed[i + 1]?.overlapIn ?? 0,
      curveIn: transitionOf(c.clip, mix).curve,
      curveOut: next ? transitionOf(next.clip, mix).curve : 'tri',
      ...fittedFades(c.edits, s.length),
      gain: 10 ** (db / 20),
    });
  });
  const duration = Math.max(0, ...out.map((c) => c.at + c.length));
  const fit = (f: Fade): Fade => ({ ...f, duration: Math.min(f.duration, duration) });
  return { clips: out, duration, fadeIn: fit(mix.fadeIn), fadeOut: fit(mix.fadeOut) };
}

/** A clip's own gain `x` seconds into it: its fades, then the crossfades, as acrossfade does. */
export function clipGain(c: LiveClip, x: number): number {
  if (x < 0 || x >= c.length) return 0;
  let g = c.gain;
  if (c.fadeIn.duration > 0 && x < c.fadeIn.duration) g *= fadeGain(c.fadeIn.curve, x / c.fadeIn.duration);
  if (c.fadeOut.duration > 0 && x > c.length - c.fadeOut.duration) g *= fadeGain(c.fadeOut.curve, (c.length - x) / c.fadeOut.duration);
  if (c.overlapIn > 0 && x < c.overlapIn) g *= fadeGain(c.curveIn, x / c.overlapIn);
  if (c.overlapOut > 0 && x > c.length - c.overlapOut) g *= fadeGain(c.curveOut, (c.length - x) / c.overlapOut);
  return g;
}

/** The mix's own fades at time t. */
export function mixGain(live: Live, t: number): number {
  let g = 1;
  const { fadeIn, fadeOut, duration } = live;
  if (fadeIn.duration > 0 && t < fadeIn.duration) g *= fadeGain(fadeIn.curve, t / fadeIn.duration);
  if (fadeOut.duration > 0 && t > duration - fadeOut.duration) g *= fadeGain(fadeOut.curve, (duration - t) / fadeOut.duration);
  return g;
}

export interface Sounding {
  index: number;
  /** Where the file is at that moment, in seconds of the file. */
  fileTime: number;
  gain: number;
}

/** The clips heard at time t: one, or two in a crossfade. */
export function soundingAt(live: Live, t: number): Sounding[] {
  if (t < 0 || t >= live.duration) return [];
  const m = mixGain(live, t);
  const out: Sounding[] = [];
  live.clips.forEach((c, index) => {
    const x = t - c.at;
    if (x >= 0 && x < c.length) out.push({ index, fileTime: c.from + x, gain: clipGain(c, x) * m });
  });
  return out;
}

/** The clip playing at time t, the later one in a crossfade; -1 outside the mix. */
export function clipAt(live: Live, t: number): number {
  const s = soundingAt(live, t);
  return s.length ? s[s.length - 1]!.index : -1;
}
