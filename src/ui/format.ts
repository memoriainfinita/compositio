// How file facts read on screen: the type badge, the short duration, sizes and the technical line.

import { extension } from '../app/intake.ts';
import { lang, t, type Lang } from '../i18n/index.ts';
import { audioTracks, fpsValue, videoTracks, type MediaInfo } from '../model/media.ts';

const number = (n: number, language: Lang, digits: number): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(n);

/** `WAV`, `MP4`: what the name says, which is what people recognise. */
export const typeBadge = (name: string): string => extension(name).toUpperCase() || '?';

/** `3:12`, `1:02:05`: the list has no room for milliseconds. */
export function shortTime(seconds: number): string {
  const s = Math.round(Math.max(0, seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** Binary units, as the 2 GB limit is: `3,4 GB`, `850 MB`. */
export function fileSize(bytes: number, language: Lang = lang.value): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${number(value, language, unit >= 2 ? 1 : 0)} ${units[unit]}`;
}

function channels(n: number, layout: string | undefined, language: Lang): string {
  if (n === 1) return t('tech.mono', {}, language);
  if (n === 2) return t('tech.stereo', {}, language);
  return layout && /^\d\.\d/.test(layout) ? layout.replace(/\(.*\)$/, '') : t('tech.channels', { n }, language);
}

/** «FLAC · 48 kHz · 24 bit · estéreo», with picture size and rate first for video. */
export function techLine(name: string, info: MediaInfo, language: Lang = lang.value): string {
  const parts = [typeBadge(name)];
  const video = videoTracks(info)[0];
  if (video) {
    const [w, h] = video.rotation % 180 ? [video.height, video.width] : [video.width, video.height];
    parts.push(`${w}×${h}`);
    if (video.fps.num > 0) parts.push(`${number(fpsValue(video.fps), language, 2)} fps`);
  }
  const audio = audioTracks(info)[0];
  if (audio) {
    if (audio.sampleRate > 0) parts.push(`${number(audio.sampleRate / 1000, language, 1)} kHz`);
    if (audio.bitDepth) parts.push(`${audio.bitDepth} bit`);
    if (audio.channels > 0) parts.push(channels(audio.channels, audio.channelLayout, language));
  }
  return parts.join(' · ');
}
