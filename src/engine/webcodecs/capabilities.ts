// What this browser can do for one video job, asked of the browser itself.

import type { Size } from '../../model/media.ts';
import type { VideoJob } from '../../model/operations.ts';
import { outputFps } from '../../model/video.ts';
import { NO_CAPABILITIES, type Capabilities } from './backend.ts';
import { h264Bitrate } from './bitrate.ts';

export const hasWebCodecs = (): boolean => typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function';

/** The job's bitrate, which the capability check and the encoder share. */
export const bitrateFor = (job: VideoJob): number => {
  const { size } = job.picture;
  return h264Bitrate(size.width, size.height, outputFps(job.picture), job.crf);
};

/** What the browser says about H.264 in general, for «Acerca de»: no file, no job. */
export async function browserVideoSupport(): Promise<{ encode: boolean; decode: boolean }> {
  if (!hasWebCodecs()) return { encode: false, decode: false };
  try {
    const { canEncodeVideo } = await import('mediabunny');
    const encode = await canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 8_000_000 });
    const decode = (await VideoDecoder.isConfigSupported({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 })).supported === true;
    return { encode, decode };
  } catch {
    return { encode: false, decode: false };
  }
}

export async function detectCapabilities(job: VideoJob, file: File): Promise<Capabilities> {
  if (!hasWebCodecs()) return NO_CAPABILITIES;
  try {
    const { ALL_FORMATS, BlobSource, Input, canEncodeVideo } = await import('mediabunny');
    const { size } = job.picture;
    // HAP is compressed by the app itself: no encoder is asked of the browser.
    const encode = job.codec === 'hap' || await canEncodeVideo('avc', { width: size.width, height: size.height, bitrate: bitrateFor(job) });
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const track = (await input.getVideoTracks())[0];
    const decode = track ? await track.canDecode() : false;
    return { api: true, encode, decode };
  } catch {
    return { api: true, encode: false, decode: false };
  }
}

/** What the browser says about a video mix: encoding its canvas, and decoding the picture of every clip that has one. */
export async function detectMixCapabilities(canvas: Size, fps: number, crf: number, files: readonly File[], needsEncoder = true): Promise<Capabilities> {
  if (!hasWebCodecs()) return NO_CAPABILITIES;
  try {
    const { ALL_FORMATS, BlobSource, Input, canEncodeVideo } = await import('mediabunny');
    const encode = !needsEncoder || await canEncodeVideo('avc', { width: canvas.width, height: canvas.height, bitrate: h264Bitrate(canvas.width, canvas.height, fps, crf) });
    let decode = true;
    for (const file of files) {
      const track = (await new Input({ formats: ALL_FORMATS, source: new BlobSource(file) }).getVideoTracks())[0];
      if (track && !(await track.canDecode())) decode = false;
    }
    return { api: true, encode, decode };
  } catch {
    return { api: true, encode: false, decode: false };
  }
}
