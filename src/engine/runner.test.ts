import { describe, expect, it } from 'vitest';
import { classify, EngineError, parseTime, progressTracker } from './runner.ts';

describe('classify', () => {
  it('keeps engine errors and recognises cancellation', () => {
    const e = new EngineError('load-failed', 'x');
    expect(classify(e)).toBe(e);
    expect(classify(new Error('called FFmpeg.terminate()'), [], true).code).toBe('cancelled');
  });

  it('recognises memory and unreadable inputs', () => {
    expect(classify(new Error('RuntimeError: memory access out of bounds')).code).toBe('out-of-memory');
    expect(classify(new Error('x'), ['Aborted(OOM)']).code).toBe('out-of-memory');
    expect(classify(new DOMException('gone', 'NotReadableError')).code).toBe('input-unreadable');
    expect(classify(undefined, ['/in/0/a.wav: Input/output error']).code).toBe('input-unreadable');
  });

  it('keeps the end of the log for a plain failure', () => {
    const log = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const e = classify(undefined, log);
    expect(e.code).toBe('ffmpeg-failed');
    expect(e.detail.split('\n')).toEqual(log.slice(-12));
  });
});

describe('progress', () => {
  it('reads the stats time', () => {
    expect(parseTime('size=   1024kB time=00:01:02.50 bitrate= 134.2kbits/s speed=40x')).toBe(62.5);
    expect(parseTime('time=01:00:00.00')).toBe(3600);
    expect(parseTime('time=N/A')).toBeNull();
    expect(parseTime('time=-00:00:00.02')).toBe(0);
  });

  it('reports ratios that only grow, capped at 1', () => {
    const seen: number[] = [];
    const track = progressTracker(100, (r) => seen.push(r));
    for (const t of ['00:00:10.00', '00:00:05.00', '00:00:50.00', '00:02:00.00']) track(`time=${t}`);
    track('no time here');
    expect(seen).toEqual([0.1, 0.5, 1]);
  });
});
