import { describe, expect, it } from 'vitest';
import { clampRect, dragRect, frameName, framedSize, initialCrop, withField } from './crop.ts';
import { videoTrack } from './fixtures.ts';

const frame = { width: 1920, height: 1080 };

describe('framedSize', () => {
  it('swaps the sides with a quarter turn, the file’s tag or the chosen one', () => {
    expect(framedSize(videoTrack(), 0)).toEqual({ width: 1920, height: 1080 });
    expect(framedSize(videoTrack(), 90)).toEqual({ width: 1080, height: 1920 });
    expect(framedSize(videoTrack({ rotation: 90 }), 0)).toEqual({ width: 1080, height: 1920 });
    expect(framedSize(videoTrack({ rotation: 90 }), 90)).toEqual({ width: 1920, height: 1080 });
    expect(framedSize(videoTrack(), 180)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('clampRect', () => {
  it('keeps the rectangle whole, inside the frame and at least two pixels a side', () => {
    expect(clampRect({ x: -5, y: 2000, width: 9999, height: 0 }, frame)).toEqual({ x: 0, y: 1078, width: 1920, height: 2 });
    expect(clampRect({ x: 10.4, y: 20.6, width: 100.2, height: 50 }, frame)).toEqual({ x: 10, y: 21, width: 100, height: 50 });
  });
});

describe('initialCrop', () => {
  it('leaves a tenth on each side with even numbers', () => {
    expect(initialCrop(frame)).toEqual({ x: 192, y: 108, width: 1536, height: 864 });
    const odd = initialCrop({ width: 101, height: 77 });
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd.x + odd.width).toBeLessThanOrEqual(101);
  });
});

describe('dragRect', () => {
  const start = { x: 200, y: 100, width: 400, height: 300 };

  it('moves the rectangle and stops it at the frame', () => {
    expect(dragRect(start, 'move', 51, -41, frame)).toEqual({ x: 252, y: 60, width: 400, height: 300 });
    expect(dragRect(start, 'move', -999, -999, frame)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(dragRect(start, 'move', 9999, 9999, frame)).toEqual({ x: 1520, y: 780, width: 400, height: 300 });
  });

  it('moves single edges and corners, snapping to even numbers', () => {
    expect(dragRect(start, 'e', 101, 0, frame)).toEqual({ x: 200, y: 100, width: 502, height: 300 });
    expect(dragRect(start, 'w', -50, 0, frame)).toEqual({ x: 150, y: 100, width: 450, height: 300 });
    expect(dragRect(start, 'n', 0, 20, frame)).toEqual({ x: 200, y: 120, width: 400, height: 280 });
    expect(dragRect(start, 'se', 10, 10, frame)).toEqual({ x: 200, y: 100, width: 410, height: 310 });
    expect(dragRect(start, 'nw', -300, -300, frame)).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  it('never turns inside out nor leaves the frame', () => {
    expect(dragRect(start, 'e', -9999, 0, frame)).toEqual({ x: 200, y: 100, width: 2, height: 300 });
    expect(dragRect(start, 's', 0, 9999, frame)).toEqual({ x: 200, y: 100, width: 400, height: 980 });
  });
});

describe('withField', () => {
  const r = { x: 100, y: 50, width: 400, height: 300 };

  it('moves with the position fields and stops at the frame', () => {
    expect(withField(r, 'x', 5000, frame)).toEqual({ x: 1520, y: 50, width: 400, height: 300 });
    expect(withField(r, 'y', -3, frame)).toEqual({ x: 100, y: 0, width: 400, height: 300 });
  });

  it('keeps the corner with the size fields and stops at the frame', () => {
    expect(withField(r, 'width', 5000, frame)).toEqual({ x: 100, y: 50, width: 1820, height: 300 });
    expect(withField(r, 'height', 1, frame)).toEqual({ x: 100, y: 50, width: 400, height: 2 });
  });
});

describe('frameName', () => {
  it('puts the instant after the name, safe for any file system', () => {
    expect(frameName('clip.mp4', 83.5, 'png')).toBe('clip-1.23.500.png');
    expect(frameName('clip.final.mov', 0, 'jpeg')).toBe('clip.final-0.00.000.jpg');
    expect(frameName('long.mp4', 3725.004, 'png')).toBe('long-1.02.05.004.png');
    expect(frameName('noext', 1, 'png')).toBe('noext-0.01.000.png');
  });
});
