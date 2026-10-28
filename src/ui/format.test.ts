import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../app/intake.ts';
import type { MediaInfo } from '../model/media.ts';
import { fileSize, shortTime, techLine, typeBadge } from './format.ts';

const flac: MediaInfo = {
  container: 'flac',
  duration: 168,
  tracks: [{ kind: 'audio', index: 0, codec: 'flac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, bitDepth: 24 }],
  tags: {},
  hasCover: false,
};

const video: MediaInfo = {
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 390,
  tracks: [
    { kind: 'video', index: 0, codec: 'h264', width: 1920, height: 1080, fps: { num: 30000, den: 1001 }, rotation: 90 },
    { kind: 'audio', index: 0, codec: 'aac', channels: 6, channelLayout: '5.1(side)', sampleRate: 44100 },
  ],
  tags: {},
  hasCover: false,
};

describe('format', () => {
  it('shows the technical line of the canvas', () => {
    expect(techLine('03 - Tormenta.flac', flac, 'es')).toBe('FLAC · 48 kHz · 24 bit · estéreo');
    expect(techLine('03 - Tormenta.flac', flac, 'en')).toBe('FLAC · 48 kHz · 24 bit · stereo');
  });

  it('puts picture first for video, turned as it plays, and leaves bit depth out of lossy audio', () => {
    expect(techLine('Ensayo.mp4', video, 'es')).toBe('MP4 · 1080×1920 · 29,97 fps · 44,1 kHz · 5.1');
    const mono: MediaInfo = { ...flac, tracks: [{ kind: 'audio', index: 0, codec: 'mp3', channels: 1, sampleRate: 22050 }] };
    expect(techLine('voz.mp3', mono, 'en')).toBe('MP3 · 22.1 kHz · mono');
    const lossy: MediaInfo = { ...flac, tracks: [{ kind: 'audio', index: 0, codec: 'mp3', channels: 2, sampleRate: 44100, bitrate: 320 }] };
    expect(techLine('03 - Tormenta.mp3', lossy, 'es')).toBe('MP3 · 44,1 kHz · 320 kbps · estéreo');
    const quad: MediaInfo = { ...flac, tracks: [{ kind: 'audio', index: 0, codec: 'pcm_s16le', channels: 4, sampleRate: 48000, bitDepth: 16 }] };
    expect(techLine('cuatro.wav', quad, 'es')).toBe('WAV · 48 kHz · 16 bit · 4 canales');
  });

  it('shortens durations and badges', () => {
    expect(shortTime(192.4)).toBe('3:12');
    expect(shortTime(59.6)).toBe('1:00');
    expect(shortTime(3725)).toBe('1:02:05');
    expect(typeBadge('a.Mp3')).toBe('MP3');
    expect(typeBadge('sin extension')).toBe('?');
  });

  it('gives sizes in binary units, as the limit is', () => {
    expect(fileSize(MAX_FILE_BYTES, 'es')).toBe('2 GB');
    expect(fileSize(3.4 * 1024 ** 3, 'es')).toBe('3,4 GB');
    expect(fileSize(850 * 1024 ** 2, 'en')).toBe('850 MB');
    expect(fileSize(2048, 'en')).toBe('2 KB');
  });
});
