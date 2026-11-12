import { describe, expect, it } from 'vitest';
import { curveGain } from './curve.ts';
import { CURVES } from './settings.ts';

describe('curveGain', () => {
  it('goes from silence to full on every curve', () => {
    for (const c of CURVES) {
      expect(curveGain(c, 1)).toBeCloseTo(1, 6);
      expect(curveGain(c, 0)).toBeLessThan(0.01);
      expect(curveGain(c, -1)).toBe(curveGain(c, 0));
      expect(curveGain(c, 2)).toBe(curveGain(c, 1));
    }
  });

  it('is a straight line for tri and the quarter sine for qsin', () => {
    expect(curveGain('tri', 0.25)).toBe(0.25);
    expect(curveGain('qsin', 0.5)).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
