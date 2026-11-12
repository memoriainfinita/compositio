import { describe, expect, it } from 'vitest';
import { parseSilences, toMediaInfo, type ProbeJson } from './probe.ts';
import wav from './fixtures/probe-tone-wav.json';
import mp3 from './fixtures/probe-tone-mp3.json';
import flac from './fixtures/probe-tone16-flac.json';
import ogg from './fixtures/probe-tone-ogg.json';
import video from './fixtures/probe-rotated-mp4.json';

// Fixtures: ffprobe 8.1.1 JSON of generated tones and a rotated H.264 video with two audio tracks.
const info = (j: unknown) => toMediaInfo(j as ProbeJson);

describe('toMediaInfo', () => {
  it('reads a 24-bit WAV', () => {
    expect(info(wav)).toEqual({
      container: 'wav',
      duration: 20,
      tracks: [{ kind: 'audio', index: 0, codec: 'pcm_s24le', channels: 2, channelLayout: 'stereo', sampleRate: 48000, bitDepth: 24 }],
      tags: {},
      hasCover: false,
    });
  });

  it('treats cover art as a cover, not a video track, and gives lossy audio a bitrate, not a bit depth', () => {
    const m = info(mp3);
    expect(m.hasCover).toBe(true);
    expect(m.tracks).toEqual([{ kind: 'audio', index: 0, codec: 'mp3', channels: 1, channelLayout: 'mono', sampleRate: 44100, bitrate: 192 }]);
    expect(m.tags).toEqual({ title: 'Tono' });
  });

  it('takes the rate of the file for a lone stream without one, and gives lossless audio none', () => {
    const lone = structuredClone(ogg) as ProbeJson;
    delete lone.streams![0]!.bit_rate;
    expect(info(lone).tracks[0]).toMatchObject({ bitrate: 23 });
    expect(info(wav).tracks[0]).not.toHaveProperty('bitrate');
    expect(info(video).tracks.filter((t) => t.kind === 'audio').map((t) => 'bitrate' in t && t.bitrate)).toEqual([70, 69]);
  });

  it('reads FLAC bit depth and tags in any case', () => {
    const m = info(flac);
    expect(m.tracks[0]).toMatchObject({ codec: 'flac', bitDepth: 16 });
    expect(m.tags).toEqual({ title: 'Flac16' });
  });

  it('reads Ogg tags from the stream', () => {
    expect(info(ogg).tags).toEqual({ title: 'Vorbis', artist: 'Banda' });
  });

  it('reads video tracks with exact fps and rotation, and numbers audio tracks', () => {
    const m = info(video);
    expect(m.duration).toBeCloseTo(3.003, 3);
    expect(m.tracks.map((t) => [t.kind, t.index, t.codec])).toEqual([
      ['video', 0, 'h264'],
      ['audio', 0, 'aac'],
      ['audio', 1, 'aac'],
    ]);
    expect(m.tracks[0]).toMatchObject({ width: 320, height: 240, fps: { num: 30000, den: 1001 }, rotation: 90 });
  });

  it('snaps rotations and survives missing fields', () => {
    const m = info({ streams: [{ codec_type: 'video', side_data_list: [{ rotation: -90 }], avg_frame_rate: '0/0', r_frame_rate: '25/1' }] });
    expect(m.tracks[0]).toMatchObject({ rotation: 270, fps: { num: 25, den: 1 }, width: 0 });
    expect(info({}).duration).toBe(0);
  });
});

describe('parseSilences', () => {
  const log = (...lines: string[]) => lines;

  it('finds the silences at both ends', () => {
    const l = log(
      '[silencedetect @ 0x1] silence_start: 0',
      '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5',
      '[silencedetect @ 0x1] silence_start: 40.2',
      '[silencedetect @ 0x1] silence_end: 41 | silence_duration: 0.8',
      '[silencedetect @ 0x1] silence_start: 118.25',
    );
    expect(parseSilences(l, 120)).toEqual({ head: 1.5, tail: 118.25 });
  });

  it('ignores silences away from the ends', () => {
    expect(parseSilences(log('silence_start: 40', 'silence_end: 41 | silence_duration: 1'), 120)).toEqual({ head: 0, tail: 120 });
  });

  it('counts a trailing silence that ffmpeg closed at the end', () => {
    expect(parseSilences(log('silence_start: 115', 'silence_end: 120 | silence_duration: 5'), 120)).toEqual({ head: 0, tail: 115 });
  });

  it('cuts nothing from a file that is all silence', () => {
    expect(parseSilences(log('silence_start: 0', 'silence_end: 10 | silence_duration: 10'), 10)).toEqual({ head: 0, tail: 10 });
  });
});

describe('toMediaInfo, video details', () => {
  const stream = (over: Record<string, unknown>) => ({ streams: [{ codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, avg_frame_rate: '30000/1001', ...over }], format: { duration: '4' } }) as ProbeJson;
  const track = (over: Record<string, unknown>) => {
    const t = toMediaInfo(stream(over)).tracks[0];
    if (t?.kind !== 'video') throw new Error('no video');
    return t;
  };

  it('reads pixel format, depth, transfer, bitrate and pixel shape', () => {
    const t = track({ pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084', bit_rate: '12000000', sample_aspect_ratio: '4:3' });
    expect(t).toMatchObject({ pixelFormat: 'yuv420p10le', bitDepth: 10, transfer: 'smpte2084', bitrate: 12000, sampleAspect: { num: 4, den: 3 } });
  });

  it('leaves out what the file does not say', () => {
    const t = track({ color_transfer: 'unknown', sample_aspect_ratio: '0:1' });
    expect(t.transfer).toBeUndefined();
    expect(t.sampleAspect).toBeUndefined();
    expect(t.pixelFormat).toBeUndefined();
  });
});
