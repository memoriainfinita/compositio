// The crop as a rectangle on the picture as seen (square pixels, rotation applied): keeping it
// inside the frame, moving its edges, and where the frame's image is taken. Pure, so the same
// rules serve the numeric fields and the dragging on the editor's picture.

import { orientedSize, type Size, type VideoTrack } from './media.ts';
import type { Rect } from './video.ts';

/** Smallest side of a crop: 4:2:0 needs even sides. */
export const MIN_CROP = 2;

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The picture as the person sees it once the file's tag and the chosen rotation are applied. */
export function framedSize(v: VideoTrack, rotate: 0 | 90 | 180 | 270): Size {
  const s = orientedSize(v);
  return rotate === 90 || rotate === 270 ? { width: s.height, height: s.width } : s;
}

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

/** A rectangle with whole numbers, at least `MIN_CROP` a side, inside the frame. */
export function clampRect(r: Rect, frame: Size): Rect {
  const width = clamp(Math.round(r.width), Math.min(MIN_CROP, frame.width), frame.width);
  const height = clamp(Math.round(r.height), Math.min(MIN_CROP, frame.height), frame.height);
  return { x: clamp(Math.round(r.x), 0, frame.width - width), y: clamp(Math.round(r.y), 0, frame.height - height), width, height };
}

/** The crop a person starts from when they turn it on: the frame less a tenth on each side. */
export function initialCrop(frame: Size): Rect {
  const even = (n: number) => n - (n % 2);
  const x = even(Math.round(frame.width * 0.1));
  const y = even(Math.round(frame.height * 0.1));
  return clampRect({ x, y, width: even(frame.width - 2 * x), height: even(frame.height - 2 * y) }, frame);
}

/**
 * The rectangle after dragging a handle by `dx`, `dy` pixels of the picture from where the drag
 * started. Edges snap to `step`; the rectangle never leaves the frame nor gets thinner than the minimum.
 */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, frame: Size, step = 2): Rect {
  const snap = (n: number) => Math.round(n / step) * step;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle === 'move') {
    const mx = clamp(snap(dx), -left, frame.width - right);
    const my = clamp(snap(dy), -top, frame.height - bottom);
    return { x: left + mx, y: top + my, width: start.width, height: start.height };
  }
  if (handle.includes('w')) left = clamp(snap(start.x + dx), 0, right - MIN_CROP);
  if (handle.includes('e')) right = clamp(snap(start.x + start.width + dx), left + MIN_CROP, frame.width);
  if (handle.includes('n')) top = clamp(snap(start.y + dy), 0, bottom - MIN_CROP);
  if (handle.includes('s')) bottom = clamp(snap(start.y + start.height + dy), top + MIN_CROP, frame.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Which of the four values a numeric field changes, kept inside the frame. */
export function withField(r: Rect, field: keyof Rect, value: number, frame: Size): Rect {
  const next = { ...r, [field]: Math.round(value) };
  // Position fields move the rectangle; size fields keep its corner and stop at the frame's edge.
  if (field === 'x') next.x = clamp(next.x, 0, frame.width - r.width);
  if (field === 'y') next.y = clamp(next.y, 0, frame.height - r.height);
  if (field === 'width') next.width = clamp(next.width, MIN_CROP, frame.width - r.x);
  if (field === 'height') next.height = clamp(next.height, MIN_CROP, frame.height - r.y);
  return next;
}

/** `name-m.ss.mmm.png`: the file's name without extension and the instant of the frame, safe in any file system. */
export function frameName(name: string, seconds: number, format: 'png' | 'jpeg'): string {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const pad = (n: number, d: number) => String(n).padStart(d, '0');
  const stamp = `${h > 0 ? `${h}.${pad(m, 2)}` : String(m)}.${pad(s, 2)}.${pad(ms, 3)}`;
  return `${name.replace(/\.[^./\\]+$/, '')}-${stamp}.${format === 'png' ? 'png' : 'jpg'}`;
}
