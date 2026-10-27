// From ffprobe's JSON to the model's MediaInfo, and from silencedetect's log to the silences at
// the ends. Pure: the jobs run the commands.

import { LOSSY_AUDIO, type MediaInfo, type MediaTags, type Rational, type Track, type VideoTrack } from '../model/media.ts';
import type { Silences } from '../model/edits.ts';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bits_per_sample?: number;
  bits_per_raw_sample?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

export interface ProbeJson {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
}

export const PROBE_ARGS = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json'] as const;

const finite = (s: string | number | undefined): number | undefined => {
  const n = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(n) ? n : undefined;
};

function rational(s: string | undefined): Rational | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? '');
  if (!m || Number(m[2]) === 0 || Number(m[1]) === 0) return undefined;
  return { num: Number(m[1]), den: Number(m[2]) };
}

/** Degrees as ffmpeg reports them, counter-clockwise, snapped to quarter turns. */
function rotation(s: ProbeStream): VideoTrack['rotation'] {
  const raw = s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? -(finite(s.tags?.rotate) ?? 0);
  const quarter = (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
  return quarter as VideoTrack['rotation'];
}

/** Tags are case-insensitive, and Ogg and Opus keep them on the stream. */
function tags(json: ProbeJson): MediaTags {
  const all: Record<string, string> = {};
  const sources = [json.format?.tags, ...(json.streams ?? []).filter((s) => s.codec_type === 'audio').map((s) => s.tags)];
  for (const source of sources) {
    for (const [k, v] of Object.entries(source ?? {})) {
      const key = k.toLowerCase();
      if (v && all[key] === undefined) all[key] = v;
    }
  }
  const out: MediaTags = {};
  if (all.title) out.title = all.title;
  if (all.artist) out.artist = all.artist;
  if (all.album) out.album = all.album;
  return out;
}

export function toMediaInfo(json: ProbeJson): MediaInfo {
  const tracks: Track[] = [];
  let audio = 0;
  let video = 0;
  let hasCover = false;
  for (const s of json.streams ?? []) {
    if (s.codec_type === 'audio') {
      const codec = s.codec_name ?? 'unknown';
      const bits = finite(s.bits_per_raw_sample) || s.bits_per_sample || undefined;
      tracks.push({
        kind: 'audio',
        index: audio++,
        codec,
        channels: s.channels ?? 0,
        ...(s.channel_layout ? { channelLayout: s.channel_layout } : {}),
        sampleRate: finite(s.sample_rate) ?? 0,
        ...(bits && !LOSSY_AUDIO.has(codec) ? { bitDepth: bits } : {}),
      });
    } else if (s.codec_type === 'video') {
      // ffmpeg counts cover art among video streams, so the index keeps counting it.
      const index = video++;
      if (s.disposition?.attached_pic === 1) {
        hasCover = true;
        continue;
      }
      tracks.push({
        kind: 'video',
        index,
        codec: s.codec_name ?? 'unknown',
        width: s.width ?? 0,
        height: s.height ?? 0,
        fps: rational(s.avg_frame_rate) ?? rational(s.r_frame_rate) ?? { num: 0, den: 1 },
        rotation: rotation(s),
      });
    }
  }
  const streamDurations = (json.streams ?? []).map((s) => finite(s.duration) ?? 0);
  return {
    container: json.format?.format_name ?? 'unknown',
    duration: finite(json.format?.duration) ?? Math.max(0, ...streamDurations),
    tracks,
    tags: tags(json),
    hasCover,
  };
}

export const SILENCE_THRESHOLD_DB = -60;
/** Shorter silences at the ends are not worth cutting. */
export const SILENCE_MIN_SECONDS = 0.1;
/** How close to an end a silence must be to count as that end's. */
const EDGE = 0.05;

export const silenceFilter = (): string => `silencedetect=n=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_MIN_SECONDS}`;

export function parseSilences(log: readonly string[], duration: number): Silences {
  const spans: { start: number; end: number | null }[] = [];
  for (const line of log) {
    const start = /silence_start:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(line);
    if (start) spans.push({ start: Math.max(0, Number(start[1])), end: null });
    const end = /silence_end:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(line);
    const open = spans.at(-1);
    if (end && open && open.end === null) open.end = Number(end[1]);
  }
  const first = spans[0];
  const last = spans.at(-1);
  const head = first && first.start <= EDGE ? (first.end ?? duration) : 0;
  const tail = last && (last.end === null || last.end >= duration - EDGE) ? last.start : duration;
  // All silence: nothing sensible to cut, so nothing is.
  return head < tail ? { head, tail } : { head: 0, tail: duration };
}
