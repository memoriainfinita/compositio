// The picture of a video job, described without saying how it is made. `describePicture` resolves
// the settings against the file (rotation tags, pixel shape, even sizes); two translators consume
// it: ffmpeg's filter chain here, and the WebCodecs frame loop in the engine.

import { ffTime, hasAnamorphicPixels, orientedSize, type Rational, type Size, type VideoTrack } from './media.ts';
import type { OutputSettings } from './settings.ts';

export type PictureSettings = OutputSettings['picture'];
export type ScaleMode = PictureSettings['scale']['mode'];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const even = (n: number): number => Math.max(2, n - (n % 2));
/** Sizes go down to a multiple of 2 (4:2:0 needs it) or of 4 (HAP's blocks). */
export type Grid = 2 | 4;
const snap = (n: number, grid: Grid): number => Math.max(grid, n - (n % grid));
const evenDown = (n: number): number => n - (n % 2);
/** A number as ffmpeg reads it, without exponents or trailing zeros. */
export const num = (n: number): string => String(Number(n.toFixed(6)));

export interface PictureDescription {
  /** The file's pixels are not square: the picture is first stretched to its true shape. */
  anamorphic: boolean;
  /** Clockwise, the user's, on top of the file's own rotation tag. */
  rotate: PictureSettings['rotate'];
  /** In square pixels of the picture as seen, with the even adjustment done; null for the whole frame. */
  crop: Rect | null;
  /** Size after rotation and crop, before scaling. */
  cropped: Size;
  mode: ScaleMode;
  /** The box the scale mode works in, even; meaningless for `source`. */
  box: Size;
  /** Size of the output picture. */
  size: Size;
  /** Something was changed to an even number, which 4:2:0 needs. */
  rounded: boolean;
  /** Fades to black in seconds of the kept range (before speed); 0 when there is none. */
  fadeIn: number;
  fadeOut: number;
  /** Seconds of the kept range, for placing the fade out. */
  length: number;
  speed: number;
  /** Frame rate of the output; the file's own when the setting is `source`. */
  fps: Rational;
}

export type PictureError = { error: 'crop-outside-frame' };

export const parseRate = (s: string): Rational => {
  const [n, d] = s.split('/').map(Number) as [number, number | undefined];
  return { num: n, den: d ?? 1 };
};

export function describePicture(
  v: VideoTrack,
  p: PictureSettings,
  fades: { fadeIn: number; fadeOut: number; length: number } | null,
  grid: Grid = 2,
): PictureDescription | PictureError {
  let rounded = false;
  let size = orientedSize(v);
  if (p.rotate === 90 || p.rotate === 270) size = { width: size.height, height: size.width };

  let crop: Rect | null = null;
  if (p.crop) {
    const { x, y, width, height } = p.crop;
    if (x + width > size.width || y + height > size.height) return { error: 'crop-outside-frame' };
    const w = even(width);
    const h = even(height);
    if (w !== width || h !== height || x % 2 || y % 2) rounded = true;
    crop = { x: evenDown(x), y: evenDown(y), width: w, height: h };
    size = { width: w, height: h };
  }
  const cropped = size;

  const { mode, width, height } = p.scale;
  const box = { width: snap(width, grid), height: snap(height, grid) };
  if (mode === 'source') {
    if (size.width % grid || size.height % grid) {
      size = { width: snap(size.width, grid), height: snap(size.height, grid) };
      rounded = true;
    }
  } else {
    if (box.width !== width || box.height !== height) rounded = true;
    if (mode === 'fit') {
      const k = Math.min(box.width / size.width, box.height / size.height);
      size = { width: snap(Math.round(size.width * k), grid), height: snap(Math.round(size.height * k), grid) };
    } else {
      size = box;
    }
  }

  const fading = fades && p.fadeToBlack;
  return {
    anamorphic: hasAnamorphicPixels(v),
    rotate: p.rotate,
    crop,
    cropped,
    mode,
    box,
    size,
    rounded,
    fadeIn: fading ? fades.fadeIn : 0,
    fadeOut: fading ? fades.fadeOut : 0,
    length: fades?.length ?? 0,
    speed: p.speed,
    fps: p.fps === 'source' ? v.fps : parseRate(p.fps),
  };
}

const EVEN_SCALE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/**
 * The chain of ffmpeg filters, in the order of the steps: square pixels, the user's rotation, crop,
 * scale, fades to black, speed, constant rate. ffmpeg applies the file's own rotation tag before.
 */
export function ffmpegPictureFilters(d: PictureDescription): string[] {
  const f: string[] = [];
  if (d.anamorphic) f.push('scale=trunc(iw*sar/2)*2:ih', 'setsar=1');
  if (d.rotate === 90 || d.rotate === 270) f.push(d.rotate === 90 ? 'transpose=1' : 'transpose=2');
  else if (d.rotate === 180) f.push('hflip', 'vflip');
  if (d.crop) f.push(`crop=${d.crop.width}:${d.crop.height}:${d.crop.x}:${d.crop.y}`);

  const { width: W, height: H } = d.box;
  if (d.mode === 'source') {
    if (d.cropped.width % 2 || d.cropped.height % 2) f.push(EVEN_SCALE);
  } else if (d.mode === 'fit') {
    f.push(`scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease`, EVEN_SCALE, 'setsar=1');
  } else if (d.mode === 'fill') {
    f.push(`scale=w=${W}:h=${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, 'setsar=1');
  } else if (d.mode === 'letterbox') {
    f.push(`scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`, 'setsar=1');
  } else {
    f.push(`scale=w=${W}:h=${H}`, 'setsar=1');
  }

  if (d.fadeIn > 0) f.push(`fade=t=in:st=0:d=${ffTime(d.fadeIn)}`);
  if (d.fadeOut > 0) f.push(`fade=t=out:st=${ffTime(d.length - d.fadeOut)}:d=${ffTime(d.fadeOut)}`);
  if (d.speed !== 1) f.push(`setpts=PTS/${num(d.speed)}`);
  if (d.fps.num > 0) f.push(`fps=${d.fps.num}/${d.fps.den}`);
  return f;
}

export interface PictureResult {
  filters: string[];
  size: Size;
  rounded: boolean;
}

/** Description and ffmpeg filters in one step. */
export function pictureFilters(
  v: VideoTrack,
  p: PictureSettings,
  fades: { fadeIn: number; fadeOut: number; length: number } | null,
): PictureResult | PictureError {
  const d = describePicture(v, p, fades);
  if ('error' in d) return d;
  return { filters: ffmpegPictureFilters(d), size: d.size, rounded: d.rounded };
}

/** Frame rate of the output as a number. */
export const outputFps = (d: Pick<PictureDescription, 'fps'>): number => (d.fps.den > 0 && d.fps.num > 0 ? d.fps.num / d.fps.den : 30);
