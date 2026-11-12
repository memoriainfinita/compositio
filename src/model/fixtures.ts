// Shared test data: media as ffmpeg would describe it.

import type { AudioTrack, MediaInfo, VideoTrack } from './media.ts';

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

export const videoTrack = (over: Partial<VideoTrack> = {}): VideoTrack => ({
  kind: 'video',
  index: 0,
  codec: 'h264',
  width: 1920,
  height: 1080,
  fps: { num: 25, den: 1 },
  rotation: 0,
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  ...over,
});

export const clip = (over: Partial<MediaInfo> = {}, v: Partial<VideoTrack> = {}): MediaInfo =>
  media({ container: 'mov,mp4,m4a,3gp,3g2,mj2', tracks: [videoTrack(v), track({ codec: 'aac', bitDepth: undefined })], ...over });
