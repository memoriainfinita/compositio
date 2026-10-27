// Shared test data: media as ffmpeg would describe it.

import type { AudioTrack, MediaInfo } from './media.ts';

export const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({
  kind: 'audio',
  index: 0,
  codec: 'pcm_s24le',
  channels: 2,
  channelLayout: 'stereo',
  sampleRate: 48000,
  bitDepth: 24,
  ...over,
});

export const media = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  container: 'wav',
  duration: 120,
  tracks: [track()],
  tags: {},
  hasCover: false,
  ...over,
});

export const mp3 = (over: Partial<MediaInfo> = {}): MediaInfo =>
  media({ container: 'mp3', tracks: [track({ codec: 'mp3', sampleRate: 44100, bitDepth: undefined })], ...over });
