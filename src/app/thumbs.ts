// Small pictures of a video file at a moment, for the mix's strip. The browser's own decoder makes
// them (Mediabunny); a file it cannot decode asks ffmpeg for the frame, in the background. They live
// as object URLs for the session, by file and moment.

import { signal } from '@preact/signals';
import type { Engine } from '../engine/index.ts';
import { videoTracks, type MediaInfo } from '../model/media.ts';

const urls = signal(new Map<string, string>());
const asked = new Set<string>();

/** Height of the pictures, in pixels. */
const HEIGHT = 96;

export const thumbKey = (fileId: string, time: number): string => `${fileId}:${time.toFixed(2)}`;

/** The picture's URL if it is made. Reading it follows the new ones as they land. */
export const thumbUrl = (key: string): string | undefined => urls.value.get(key);

function keep(key: string, blob: Blob): void {
  const next = new Map(urls.peek());
  next.set(key, URL.createObjectURL(blob));
  urls.value = next;
}

async function viaBrowser(file: File, time: number): Promise<Blob | null> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import('mediabunny');
  const track = (await new Input({ formats: ALL_FORMATS, source: new BlobSource(file) }).getVideoTracks())[0];
  if (!track || !(await track.canDecode())) return null;
  const wrapped = await new CanvasSink(track, { height: HEIGHT }).getCanvas(time);
  if (!wrapped) return null;
  const { canvas } = wrapped;
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

/** Makes the picture once; asking again for the same one does nothing. */
export function requestThumb(key: string, file: File, info: MediaInfo, time: number, engine: Pick<Engine, 'frame'> | null): void {
  if (asked.has(key) || urls.peek().has(key)) return;
  const video = videoTracks(info)[0];
  if (!video) return;
  asked.add(key);
  void (async () => {
    try {
      const blob = (await viaBrowser(file, time)) ?? (engine ? await engine.frame(file, { video, time, format: 'jpeg' }) : null);
      if (blob) keep(key, blob);
      else asked.delete(key);
    } catch {
      // Without a picture the clip shows its sound, as before.
      asked.delete(key);
    }
  })();
}
