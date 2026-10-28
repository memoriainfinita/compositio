// What a file contains, by track. Filled from ffmpeg's report by the engine (step 4); the model
// only describes it. Times are seconds as numbers everywhere in the model.

export interface Rational {
  num: number;
  den: number;
}

export interface AudioTrack {
  kind: 'audio';
  /** Position among the file's audio tracks (ffmpeg `0:a:N`). */
  index: number;
  codec: string;
  channels: number;
  channelLayout?: string;
  sampleRate: number;
  /** Bits per sample of lossless sources; absent for lossy codecs, which decode to float. */
  bitDepth?: number;
  /** Kilobits per second of lossy sources, when the file says. */
  bitrate?: number;
}

export interface VideoTrack {
  kind: 'video';
  /** Position among the file's video tracks (ffmpeg `0:v:N`). Cover art is not a track. */
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: Rational;
  rotation: 0 | 90 | 180 | 270;
}

export type Track = AudioTrack | VideoTrack;

export interface MediaTags {
  title?: string;
  artist?: string;
  album?: string;
}

export interface MediaInfo {
  container: string;
  duration: number;
  tracks: Track[];
  tags: MediaTags;
  hasCover: boolean;
}

export const LOSSY_AUDIO = new Set(['mp3', 'aac', 'opus', 'vorbis', 'wmav2', 'ac3', 'eac3']);

export const audioTracks = (info: MediaInfo): AudioTrack[] =>
  info.tracks.filter((t): t is AudioTrack => t.kind === 'audio');

export const videoTracks = (info: MediaInfo): VideoTrack[] =>
  info.tracks.filter((t): t is VideoTrack => t.kind === 'video');

export const isVideo = (info: MediaInfo): boolean => videoTracks(info).length > 0;

export const fpsValue = (fps: Rational): number => fps.num / fps.den;

/** Seconds as ffmpeg reads them: fixed microsecond precision, never exponent notation. */
export const ffTime = (seconds: number): string => Math.max(0, seconds).toFixed(6);

/** Seconds as people read them: `h:mm:ss.mmm`, hours only when needed. */
export function clockTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = `${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
