// The curves of fades and crossfades as numbers: afade's own (libavfilter/af_afade.c), for a
// position from 0 to 1 into the fade. The mix's picture follows the same function, so a crossfade
// of sound and of picture have one shape in every engine.

import type { Curve } from './settings.ts';

export function curveGain(curve: Curve, x: number): number {
  const g = Math.min(Math.max(x, 0), 1);
  switch (curve) {
    case 'tri':
      return g;
    case 'qsin':
      return Math.sin((g * Math.PI) / 2);
    case 'hsin':
      return (1 - Math.cos(g * Math.PI)) / 2;
    case 'esin':
      return 1 - Math.cos((Math.PI / 4) * ((2 * g - 1) ** 3 + 1));
    case 'log':
      return Math.min(Math.max(1 + 0.2 * Math.log10(g), 0), 1);
    case 'exp':
      return Math.exp(-11.512925464970227 * (1 - g));
  }
}
