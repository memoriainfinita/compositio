import { describe, expect, it } from 'vitest';
import { EXAMPLE_SECONDS, exampleFiles, wavBytes } from './example.ts';
import { reportText } from './report.ts';

describe('example tracks', () => {
  it('are 16-bit stereo WAV of the stated length', () => {
    const b = wavBytes(2, [440], 8000);
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(2 * 8000 * 4);
  });

  it('start and end in silence and carry their names', () => {
    const files = exampleFiles(['a.wav', 'b.wav', 'c.wav']);
    expect(files.map((f) => f.name)).toEqual(['a.wav', 'b.wav', 'c.wav']);
    expect(files[0]!.size).toBe(44 + EXAMPLE_SECONDS * 44100 * 4);
    const b = wavBytes(1, [440], 8000);
    const v = new DataView(b.buffer);
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(b.length - 4, true)).toBe(0);
  });
});

describe('reportText', () => {
  it('lists the facts and the failed jobs with their log', () => {
    const text = reportText({
      version: '0.1.0',
      userAgent: 'Firefox',
      isolated: true,
      multithread: true,
      layout: 'desktop',
      language: 'es',
      jobs: [
        { id: '1', label: 'a.wav', priority: 'user', status: 'failed', progress: 0, error: 'ffmpeg-failed', detail: 'line 1\nline 2' },
        { id: '2', label: 'b.wav', priority: 'user', status: 'done', progress: 1 },
      ],
    });
    expect(text).toBe(
      'compositio 0.1.0\nbrowser: Firefox\nisolated: true, multithread: true\nlayout: desktop, language: es\nfailed jobs: 1\n- a.wav: ffmpeg-failed\n    line 1\n    line 2\n',
    );
  });
});
