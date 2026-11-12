/// <reference lib="webworker" />
// Makes a video with WebCodecs: decodes the input's frames, draws each on a canvas with the picture's
// geometry, encodes H.264 and writes an mp4 straight to OPFS, together with the sound ffmpeg made.
// A mix does the same with several inputs: the frames of the clips on screen are drawn one over the
// other with the transition's curve.

import { ALL_FORMATS, BlobSource, CanvasSource, EncodedAudioPacketSource, EncodedPacketSink, Input, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { Rational } from '../../model/media.ts';
import type { HapVariant } from '../../model/settings.ts';
import { outputFps, type PictureDescription } from '../../model/video.ts';
import { HapPool } from '../hap/pool.ts';
import { HapSink } from '../hap/sink.ts';
import { layersAt } from './layers.ts';
import { OUTPUT_DIR, type MixRequest, type RunRequest, type WorkerMessage, type WorkerRequest } from './protocol.ts';
import { fadeAlpha, FrameCursor, outputFrameCount, resample } from './resample.ts';

const post = (m: WorkerMessage) => postMessage(m);

/** How the picture goes into the canvas: `source`, `fit` and `stretch` fill a canvas of their own shape. */
const FIT: Record<PictureDescription['mode'], 'fill' | 'cover' | 'contain'> = {
  source: 'fill',
  fit: 'fill',
  stretch: 'fill',
  fill: 'cover',
  letterbox: 'contain',
};

type Ctx = OffscreenCanvasRenderingContext2D;

/** A frame on the canvas with the picture's rotation, crop and fit; `alpha` is what fades to black leave of it. */
function drawFrame(ctx: Ctx, frame: VideoSample, pic: PictureDescription, alpha: number): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  const crop = pic.crop ? { left: pic.crop.x, top: pic.crop.y, width: pic.crop.width, height: pic.crop.height } : undefined;
  // The file's own rotation plus the user's, turned before the crop and the fit.
  const rotation = ((frame.rotation + pic.rotate) % 360) as 0 | 90 | 180 | 270;
  frame.drawWithFit(ctx, { fit: FIT[pic.mode], rotation, ...(crop ? { crop } : {}) });
  ctx.globalAlpha = 1;
}

const black = (ctx: Ctx, canvas: OffscreenCanvas) => {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
};

/** Where the frames of the canvas go: an H.264 mp4 by Mediabunny, or a HAP mov by the app's own encoder. */
interface Destination {
  /** Takes the canvas as it is as the frame at `time`. */
  add(time: number, duration: number): Promise<void>;
  /** Closes the file; returns its size. */
  finish(): Promise<number>;
  /** Lets go of what is open, after a failure. */
  abort(): void;
}

interface DestinationRequest {
  out: string;
  audio: File | null;
  bitrate: number;
  fps: number;
  rate: Rational;
  hap: HapVariant | null;
}

let active: Destination | null = null;

async function openDestination(r: DestinationRequest, canvas: OffscreenCanvas, ctx: Ctx): Promise<Destination> {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(OUTPUT_DIR, { create: true });
  const handle = await dir.getFileHandle(r.out, { create: true });
  if (r.hap) {
    const access = await handle.createSyncAccessHandle();
    const sink = await HapSink.open({
      sink: {
        write: (data, at) => {
          let done = 0;
          while (done < data.length) done += access.write(data.subarray(done), { at: at + done });
        },
      },
      read: () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer as ArrayBuffer,
      width: canvas.width,
      height: canvas.height,
      rate: r.rate,
      variant: r.hap,
      audio: r.audio,
      encoder: new HapPool(),
    });
    const close = () => {
      sink.close();
      try {
        access.close();
      } catch {
        // already closed
      }
    };
    return {
      add: () => sink.add(),
      finish: async () => {
        const size = await sink.finish();
        access.flush();
        close();
        return size;
      },
      abort: close,
    };
  }
  const writable = await handle.createWritable();
  // The index at the end: a monolithic mdat streams to disk, and the files are for playing locally.
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable) });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: r.bitrate, latencyMode: 'quality' });
  output.addVideoTrack(source, { frameRate: r.fps });
  const pumpAudio = await prepareAudio(output, r.audio);
  await output.start();
  return {
    add: (time, duration) => source.add(time, duration),
    finish: async () => {
      source.close();
      await pumpAudio();
      await output.finalize();
      return (await handle.getFile()).size;
    },
    abort: () => void output.cancel().catch(() => {}),
  };
}

/** The sound ffmpeg made goes into the mp4 as it is, packet by packet. */
async function prepareAudio(output: Output, file: File | null): Promise<() => Promise<void>> {
  if (!file) return async () => {};
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return async () => {};
  const audioSource = new EncodedAudioPacketSource('aac');
  output.addAudioTrack(audioSource);
  return async () => {
    const config = await track.getDecoderConfig();
    const packets = new EncodedPacketSink(track);
    let first = true;
    for await (const packet of packets.packets()) {
      await audioSource.add(packet, first && config ? { decoderConfig: config } : undefined);
      first = false;
    }
    audioSource.close();
  };
}

async function run(req: RunRequest): Promise<number> {
  const { job, bitrate } = req;
  const pic = job.picture;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.file) });
  const track = (await input.getVideoTracks())[0];
  if (!track) throw new Error('no video track');
  const fps = outputFps(pic);
  const plan = { start: job.start, length: job.length, speed: job.speed, fps };
  const count = outputFrameCount(plan);

  const canvas = new OffscreenCanvas(pic.size.width, pic.size.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const dest = (active = await openDestination({ out: req.out, audio: req.audio, bitrate, fps, rate: pic.fps, hap: job.codec === 'hap' ? job.hapVariant : null }, canvas, ctx));

  const sink = new VideoSampleSink(track);
  const frames = sink.samples(job.start, job.start + job.length);
  let lastReport = 0;
  for await (const r of resample(frames, plan, (s) => s.close())) {
    black(ctx, canvas);
    drawFrame(ctx, r.frame, pic, fadeAlpha(r.within, job.length, pic.fadeIn, pic.fadeOut));
    await dest.add(r.time, 1 / fps);
    const now = performance.now();
    if (now - lastReport > 100) {
      lastReport = now;
      post({ type: 'progress', ratio: Math.min(0.99, (r.index + 1) / count) });
    }
  }
  return dest.finish();
}

/** A clip being read: its file, and the frames in order from where its kept range starts. */
interface Open {
  cursor: FrameCursor<VideoSample>;
}

async function mix(req: MixRequest): Promise<number> {
  const { segments, fps } = req;
  const count = Math.max(1, Math.round(req.duration * fps));
  const canvas = new OffscreenCanvas(req.width, req.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // The incoming clip is drawn here when two are on screen, to blend it over the other.
  const layer = new OffscreenCanvas(req.width, req.height);
  const lctx = layer.getContext('2d', { alpha: false })!;
  const dest = (active = await openDestination({ out: req.out, audio: req.audio, bitrate: req.bitrate, fps, rate: req.rate, hap: req.hap }, canvas, ctx));

  const opened = new Map<number, Open>();
  const open = async (i: number): Promise<Open | null> => {
    const have = opened.get(i);
    if (have) return have;
    const s = segments[i]!;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.files[s.file]!) });
    const track = (await input.getVideoTracks())[0];
    if (!track) return null;
    const frames = new VideoSampleSink(track).samples(s.start, s.start + s.length);
    const o = { cursor: new FrameCursor(frames, (f: VideoSample) => f.close()) };
    opened.set(i, o);
    return o;
  };

  // A segment's own picture, on black, as it would be alone: its fades to black are already in it.
  const paint = async (c: Ctx, cv: OffscreenCanvas, i: number, within: number) => {
    const s = segments[i]!;
    black(c, cv);
    if (!s.picture) return;
    const o = await open(i);
    const frame = await o?.cursor.at(s.start + within);
    if (frame) drawFrame(c, frame, s.picture, fadeAlpha(within, s.length, s.picture.fadeIn, s.picture.fadeOut));
  };

  let lastReport = 0;
  for (let k = 0; k < count; k++) {
    const t = k / fps;
    const layers = layersAt(segments, t);
    if (layers.length === 0) black(ctx, canvas);
    for (const [n, l] of layers.entries()) {
      if (n === 0) {
        await paint(ctx, canvas, l.segment, l.within);
      } else {
        await paint(lctx, layer, l.segment, l.within);
        ctx.globalAlpha = l.alpha;
        ctx.drawImage(layer, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    // Clips that are over free their decoder.
    for (const [i, o] of opened) {
      const s = segments[i]!;
      if (t >= s.at + s.length) {
        await o.cursor.close();
        opened.delete(i);
      }
    }
    // The mix's own fades take the whole picture to black.
    const a = fadeAlpha(t, req.duration, req.fadeIn, req.fadeOut);
    if (a < 1) {
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    await dest.add(t, 1 / fps);
    const now = performance.now();
    if (now - lastReport > 100) {
      lastReport = now;
      post({ type: 'progress', ratio: Math.min(0.99, (k + 1) / count) });
    }
  }
  for (const o of opened.values()) await o.cursor.close();
  return dest.finish();
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    post({ type: 'done', size: await (e.data.type === 'mix' ? mix(e.data) : run(e.data)) });
  } catch (error) {
    active?.abort();
    const err = error as Error;
    post({ type: 'error', name: err?.name ?? 'Error', message: String(err?.message ?? error) });
  }
};
