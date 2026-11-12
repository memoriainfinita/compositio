// Which clips of a video mix are on screen at an instant, and how opaque each is. At most two: the
// layout never lets a transition pass the length of its neighbours. The incoming clip is drawn over
// the outgoing one with the transition's curve as its opacity, which is what a crossfade is.

import { curveGain } from '../../model/curve.ts';
import type { MixSegment } from '../../model/mix.ts';

export interface Layer {
  /** Position of the segment in the mix. */
  segment: number;
  /** 1 for a clip on its own or going out; the curve while it comes in. */
  alpha: number;
  /** Seconds into the clip's kept range, for its fades. */
  within: number;
}

const EPSILON = 1e-9;

/** The layers at time `t` of the mix, the outgoing clip first. */
export function layersAt(segments: readonly MixSegment[], t: number): Layer[] {
  const out: Layer[] = [];
  segments.forEach((s, i) => {
    if (t < s.at - EPSILON || t >= s.at + s.length - EPSILON) return;
    const within = Math.max(0, t - s.at);
    const coming = s.overlapIn > 0 && within < s.overlapIn;
    out.push({ segment: i, alpha: coming ? curveGain(s.curve, within / s.overlapIn) : 1, within });
  });
  return out;
}
