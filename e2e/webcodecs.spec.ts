/* eslint-disable @typescript-eslint/no-explicit-any -- the page globals the tests reach through `evaluate` are untyped */
import { expect, test, type Page } from '@playwright/test';

// The WebCodecs engine (Mediabunny in a worker, output in OPFS) against ffmpeg.wasm, in Firefox
// (H.264 by software) and, with `--project=webcodecs-chrome`, in Chrome (hardware). Test media is
// made by ffmpeg.wasm; the page imports the engine modules from the dev server.

test.describe.configure({ mode: 'serial', timeout: 240_000 });

let page: Page;
// What this browser can do with H.264: a CI runner's Firefox or Chrome often has no codec at all.
let canDecode = false;
let canEncode = false;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('./');
  await page.waitForFunction(() => self.crossOriginIsolated);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ WasmRunner, coreUrls }, engine, mb, settings, edits, timeline] = await Promise.all([
      load('/src/engine/wasm-runner.ts'),
      load('/src/engine/index.ts'),
      load('/node_modules/mediabunny/dist/modules/src/index.js'),
      load('/src/model/settings.ts'),
      load('/src/model/edits.ts'),
      load('/src/model/timeline.ts'),
    ]);
    const mode = { value: 'auto' };
    const runner = new WasmRunner(coreUrls('ffmpeg/core-0.12.10/'), coreUrls('ffmpeg/core-mt-0.12.10/'));
    const make = async (name: string, args: string[], inputs: File[] = []) => {
      const r = await runner.run({ inputs, args: ['-hide_banner', '-y', ...args, `/out/${name}`], outputs: [name] });
      if (r.code !== 0) throw new Error(r.log.slice(-5).join('\n'));
      return new File([r.files.get(name)], name);
    };
    Object.assign(globalThis, { t: { runner, make, mode, engine: engine.createEngine(runner, undefined, () => mode.value), mb, settings, edits, timeline } });
  });
});

test.beforeAll(async () => {
  const support = await page.evaluate(async () => {
    const ok = async (api: 'VideoDecoder' | 'VideoEncoder', config: object) => {
      const target = (globalThis as any)[api];
      return typeof target === 'function' && (await target.isConfigSupported(config).then((r: { supported?: boolean }) => !!r.supported, () => false));
    };
    return {
      decode: await ok('VideoDecoder', { codec: 'avc1.640028' }),
      encode: await ok('VideoEncoder', { codec: 'avc1.640028', width: 640, height: 360 }),
    };
  });
  canDecode = support.decode;
  canEncode = support.encode;
});

const needsH264 = () => test.skip(!canDecode || !canEncode, 'this browser has no H.264 decoder and encoder');

test.afterAll(async () => {
  await page.close();
});

test('joins video from Mediabunny with AAC packets from ffmpeg into an mp4 in OPFS', async () => {
  needsH264();
  const r = await page.evaluate(async () => {
    const { make, engine, mb } = (globalThis as never as { t: any }).t;
    const clip = await make('v.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']);
    const audio = await make('a.m4a', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'aac', '-b:a', '128k']);
    const vin = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(clip) });
    const ain = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(audio) });
    const vt = await vin.getPrimaryVideoTrack();
    const at = await ain.getPrimaryAudioTrack();
    const aconfig = await at.getDecoderConfig();

    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('compositio-out', { create: true });
    const handle = await dir.getFileHandle('joined.mp4', { create: true });
    const writable = await handle.createWritable();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false }), target: new mb.StreamTarget(writable) });
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d')!;
    const vsrc = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000 });
    const asrc = new mb.EncodedAudioPacketSource('aac');
    output.addVideoTrack(vsrc, { frameRate: 25 });
    output.addAudioTrack(asrc);
    await output.start();

    const vsink = new mb.VideoSampleSink(vt);
    let frames = 0;
    for await (const s of vsink.samples()) {
      ctx.drawImage(s.toCanvasImageSource(), 0, 0);
      await vsrc.add(s.timestamp, s.duration);
      s.close();
      frames++;
    }
    vsrc.close();
    const asink = new mb.EncodedPacketSink(at);
    let first = true;
    let packets = 0;
    for await (const p of asink.packets()) {
      await asrc.add(p, first ? { decoderConfig: aconfig } : undefined);
      first = false;
      packets++;
    }
    asrc.close();
    await output.finalize();

    const file: File = await handle.getFile();
    const info = await engine.probe(file);
    // The browser decodes the picture and reaches the end.
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.src = url;
    const played = await new Promise<string>((resolve) => {
      v.onerror = () => resolve('error');
      v.onloadedmetadata = () => {
        v.currentTime = 3.5;
      };
      v.onseeked = () => resolve(`ok ${v.videoWidth}x${v.videoHeight} ${v.duration.toFixed(2)}`);
      setTimeout(() => resolve('timeout'), 15000);
    });
    await dir.removeEntry('joined.mp4');
    return { frames, packets, size: file.size, info, played };
  });
  expect(r.frames).toBe(100);
  expect(r.info.tracks.map((t: { kind: string; codec: string }) => `${t.kind}:${t.codec}`).sort()).toEqual(['audio:aac', 'video:h264']);
  expect(r.info.duration).toBeCloseTo(4, 0);
  expect(r.played).toMatch(/^ok 320x180/);
});

interface Probed {
  duration: number;
  tracks: { kind: string; codec: string; width?: number; height?: number; fps?: { num: number; den: number }; pixelFormat?: string }[];
}
interface Compared {
  name: string;
  ff: { info: Probed; size: number };
  wc: { info: Probed; size: number };
  psnr: number | null;
  webcodecsUsed: boolean;
}

const CASES: [string, object, object?][] = [
  ['defaults', {}],
  ['rotate 90 fit', { picture: { rotate: 90, scale: { mode: 'fit', width: 200, height: 200 } } }],
  ['crop', { picture: { crop: { x: 100, y: 50, width: 320, height: 180 } } }],
  ['letterbox', { picture: { scale: { mode: 'letterbox', width: 480, height: 480 } } }],
  ['fill', { picture: { scale: { mode: 'fill', width: 300, height: 300 } } }],
  ['speed 2', { picture: { speed: 2 } }],
  ['trim and fades', {}, { in: 1, out: 4, fadeIn: { duration: 0.5, curve: 'tri' }, fadeOut: { duration: 0.5, curve: 'tri' } }],
  ['fps 30 and normalize', { picture: { fps: '30' }, normalize: { enabled: true } }],
];

test('both engines make the same video, in a different way', async () => {
  needsH264();
  test.setTimeout(900_000);
  const results: Compared[] = await page.evaluate(async (cases) => {
    const { make, engine, mode, settings, edits, runner } = (globalThis as never as { t: any }).t;
    const clip = await make('clip.mp4', [
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ]);
    const info = await engine.probe(clip);
    const out: unknown[] = [];
    for (const [name, own, e] of cases) {
      const input = {
        info,
        edits: { ...edits.defaultEdits(), ...(e ?? {}) },
        settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video' }, ...own }),
      };
      mode.value = 'ffmpeg';
      const ff = await engine.process(`${name} ff`, clip, input).result;
      mode.value = 'webcodecs';
      const wc = await engine.process(`${name} wc`, clip, input).result;
      const ffFile = new File([ff.blob], 'ff.mp4');
      const wcFile = new File([wc.blob], 'wc.mp4');
      const [ffInfo, wcInfo] = [await engine.probe(ffFile), await engine.probe(wcFile)];
      // Mean PSNR between the two, with ffmpeg itself.
      const r = await runner.run({ inputs: [ffFile, wcFile], args: ['-hide_banner', '-i', '/in/0/ff.mp4', '-i', '/in/1/wc.mp4', '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], outputs: [] });
      const m = /average:(\S+)/.exec(r.log.join('\n'));
      out.push({
        name,
        ff: { info: ffInfo, size: ff.blob.size },
        wc: { info: wcInfo, size: wc.blob.size },
        psnr: m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null,
        webcodecsUsed: !wc.warnings.includes('webcodecs-fallback') && wc.release !== undefined,
      });
      await wc.release?.();
    }
    mode.value = 'auto';
    return out as never;
  }, CASES);
  const video = (i: Probed) => i.tracks.find((t) => t.kind === 'video')!;
  const audio = (i: Probed) => i.tracks.find((t) => t.kind === 'audio');
  for (const r of results) {
    const where = r.name;
    console.log(`${where}: psnr ${r.psnr} size ff ${r.ff.size} wc ${r.wc.size} ratio ${(r.wc.size / r.ff.size).toFixed(2)}`);
    expect(r.webcodecsUsed, where).toBe(true);
    expect(video(r.wc.info).codec, where).toBe('h264');
    expect(video(r.wc.info).width, where).toBe(video(r.ff.info).width);
    expect(video(r.wc.info).height, where).toBe(video(r.ff.info).height);
    expect(video(r.wc.info).pixelFormat, where).toBe('yuv420p');
    const f = video(r.ff.info).fps!;
    const w = video(r.wc.info).fps!;
    expect(w.num / w.den, where).toBeCloseTo(f.num / f.den, 1);
    expect(Math.abs(r.wc.info.duration - r.ff.info.duration), where).toBeLessThan(0.25);
    expect(audio(r.wc.info)?.codec, where).toBe(audio(r.ff.info)?.codec);
    expect(r.psnr, where).toBeGreaterThan(24);
    expect(r.wc.size / r.ff.size, where).toBeGreaterThan(0.2);
    expect(r.wc.size / r.ff.size, where).toBeLessThan(5);
  }
});

test('without WebCodecs the automatic engine uses ffmpeg and a forced one says why', async () => {
  const r = await page.evaluate(async () => {
    const { make, engine, mode, settings, edits } = (globalThis as never as { t: any }).t;
    const clip = await make('small.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']);
    const info = await engine.probe(clip);
    const input = { info, edits: edits.defaultEdits(), settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video' } }) };
    const saved = (globalThis as any).VideoEncoder;
    delete (globalThis as any).VideoEncoder;
    try {
      mode.value = 'auto';
      const a = await engine.process('auto', clip, input).result;
      const assessed = await engine.assess(clip, input);
      mode.value = 'webcodecs';
      const forced = await engine.process('forced', clip, input).result.then(
        () => 'ok',
        (e: { code: string; detail: string }) => `${e.code} ${e.detail}`,
      );
      return { autoSize: a.blob.size, inMemory: a.release === undefined, assessed, forced };
    } finally {
      (globalThis as any).VideoEncoder = saved;
      mode.value = 'auto';
    }
  });
  expect(r.autoSize).toBeGreaterThan(1000);
  expect(r.inMemory).toBe(true);
  expect(r.assessed?.backend).toBe('ffmpeg');
  expect(r.forced).toBe('invalid-input forced-webcodecs-unavailable');
});

test('cancelling a WebCodecs job leaves nothing in OPFS', async () => {
  needsH264();
  const r = await page.evaluate(async () => {
    const { make, engine, mode, settings, edits } = (globalThis as never as { t: any }).t;
    const clip = await make('long.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']);
    const info = await engine.probe(clip);
    const input = { info, edits: edits.defaultEdits(), settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video', audio: 'none' } }) };
    mode.value = 'webcodecs';
    const job = engine.process('long', clip, input);
    await new Promise<void>((resolve) => {
      const stop = engine.queue.subscribe((jobs: { status: string; progress: number }[]) => {
        if (jobs.some((j) => j.status === 'running' && j.progress > 0.05)) {
          stop();
          resolve();
        }
      });
    });
    engine.queue.cancel(job.id);
    const code = await job.result.then(
      () => 'done',
      (e: { code: string }) => e.code,
    );
    mode.value = 'auto';
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('compositio-out', { create: true });
    const names: string[] = [];
    for await (const n of (dir as any).keys()) names.push(n);
    return { code, names };
  });
  expect(r.code).toBe('cancelled');
  expect(r.names).toEqual([]);
});

test('each engine stays close to the source picture', async () => {
  needsH264();
  const r = await page.evaluate(async () => {
    const { make, engine, mode, settings, edits, runner } = (globalThis as never as { t: any }).t;
    const clip = await make('ref.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=4', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-an']);
    const info = await engine.probe(clip);
    const input = { info, edits: edits.defaultEdits(), settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video', audio: 'none' } }) };
    const psnr = async (file: File) => {
      const res = await runner.run({ inputs: [clip, file], args: ['-hide_banner', '-i', '/in/0/ref.mp4', '-i', '/in/1/x.mp4', '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], outputs: [] });
      return Number(/average:(\S+)/.exec(res.log.join('\n'))?.[1]);
    };
    const out: Record<string, number> = {};
    for (const m of ['ffmpeg', 'webcodecs']) {
      mode.value = m;
      const done = await engine.process(m, clip, input).result;
      out[m] = await psnr(new File([done.blob], 'x.mp4'));
      await done.release?.();
    }
    mode.value = 'auto';
    return out;
  });
  console.log(JSON.stringify(r));
  expect(r.ffmpeg).toBeGreaterThan(34);
  // Same picture, in place and in colour: what separates the engines is the encoder, which is weaker in software (Firefox).
  // A hard synthetic test card at a modest bitrate; real footage will do better.
  expect(r.webcodecs).toBeGreaterThan(24);
});

test('both engines make the same video mix: canvas, length, sound and the crossfade', async () => {
  needsH264();
  test.setTimeout(900_000);
  const results = await page.evaluate(async () => {
    const { make, engine, mode, settings, edits, timeline, runner } = (globalThis as never as { t: any }).t;
    const a = await make('a.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    const b = await make('b.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    const c = await make('c.wav', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3']);
    const files = [a, b, c];
    const infos = await Promise.all(files.map((f) => engine.probe(f)));
    const clips = files.map((_, i) => ({
      clip: { id: `c${i}`, fileId: `f${i}`, kind: i < 2 ? 'video' : 'audio', transitionIn: null },
      info: infos[i],
      edits: edits.defaultEdits(),
      settings: settings.defaultSettings(),
      silences: null,
    }));
    const base = timeline.defaultMix();
    const out: unknown[] = [];
    const cases: [string, object][] = [
      ['crossfade', { transition: { duration: 1, curve: 'tri', cut: false, style: 'dissolve' } }],
      ['dry cut and black', { transition: { duration: 0, curve: 'tri', cut: true, style: 'dissolve' } }],
      ['fixed canvas, fills, mix fades', { transition: { duration: 1, curve: 'qsin', cut: false, style: 'dissolve' }, fadeIn: { duration: 0.5, curve: 'tri' }, fadeOut: { duration: 0.5, curve: 'tri' }, video: { ...base.video, canvas: 'fixed', width: 256, height: 256, fit: 'fill', fps: '30' } }],
    ];
    for (const [name, over] of cases) {
      const input = { clips, files, mix: { ...base, kind: 'video', ...over }, measured: new Map() };
      mode.value = 'ffmpeg';
      const ff = await engine.mix(`${name} ff`, input).result;
      mode.value = 'webcodecs';
      const wc = await engine.mix(`${name} wc`, input).result;
      const ffFile = new File([ff.blob], 'ff.mp4');
      const wcFile = new File([wc.blob], 'wc.mp4');
      const [ffInfo, wcInfo] = [await engine.probe(ffFile), await engine.probe(wcFile)];
      const r = await runner.run({ inputs: [ffFile, wcFile], args: ['-hide_banner', '-i', '/in/0/ff.mp4', '-i', '/in/1/wc.mp4', '-lavfi', '[0:v][1:v]scale2ref=flags=bicubic[a][b];[a][b]psnr', '-f', 'null', '-'], outputs: [] });
      const m = /average:(\S+)/.exec(r.log.join(String.fromCharCode(10)));
      out.push({
        name,
        ff: { info: ffInfo, warnings: ff.warnings },
        wc: { info: wcInfo, warnings: wc.warnings },
        psnr: m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null,
        webcodecsUsed: !wc.warnings.includes('webcodecs-fallback') && wc.release !== undefined,
      });
      await wc.release?.();
    }
    mode.value = 'auto';
    return out as never;
  });
  const video = (i: Probed) => i.tracks.find((t) => t.kind === 'video')!;
  const audio = (i: Probed) => i.tracks.find((t) => t.kind === 'audio');
  for (const r of results as { name: string; ff: { info: Probed; warnings: string[] }; wc: { info: Probed; warnings: string[] }; psnr: number | null; webcodecsUsed: boolean }[]) {
    console.log(`${r.name}: psnr ${r.psnr} duration ff ${r.ff.info.duration.toFixed(2)} wc ${r.wc.info.duration.toFixed(2)}`);
    expect(r.webcodecsUsed, r.name).toBe(true);
    expect(video(r.wc.info).width, r.name).toBe(video(r.ff.info).width);
    expect(video(r.wc.info).height, r.name).toBe(video(r.ff.info).height);
    expect(video(r.wc.info).codec, r.name).toBe('h264');
    expect(audio(r.wc.info)?.codec, r.name).toBe('aac');
    expect(Math.abs(r.wc.info.duration - r.ff.info.duration), r.name).toBeLessThan(0.3);
    expect(r.psnr, r.name).toBeGreaterThan(22);
  }
  const [crossfade, , fixed] = results as { name: string; ff: { info: Probed; warnings: string[] }; wc: { info: Probed; warnings: string[] } }[];
  // 4 + 4 + 3 s with the crossfades taken out.
  expect(crossfade!.wc.info.duration).toBeCloseTo(9, 0);
  expect(video(fixed!.wc.info).width).toBe(256);
  // ffmpeg's xfade is straight whatever the curve, and says so; WebCodecs follows the curve.
  expect(fixed!.ff.warnings).toContain('video-curve-linear');
  expect(fixed!.wc.warnings).not.toContain('video-curve-linear');
});

test('HAP: a clip and a mix come out as a mov that ffmpeg reads, with picture and sound; without a decoder it says why', async () => {
  test.skip(!canDecode, 'this browser cannot decode H.264, which HAP needs');
  test.setTimeout(600_000);
  const r = await page.evaluate(async () => {
    const { make, engine, mode, settings, edits, timeline, runner } = (globalThis as never as { t: any }).t;
    const clip = await make('clip.mp4', [
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ]);
    const info = await engine.probe(clip);
    const psnr = async (file: File) => {
      const res = await runner.run({ inputs: [clip, file], args: ['-hide_banner', '-i', '/in/0/clip.mp4', '-i', '/in/1/x.mov', '-lavfi', '[0:v][1:v]scale2ref=flags=bicubic[a][b];[a][b]psnr', '-f', 'null', '-'], outputs: [] });
      const m = /average:(\S+)/.exec(res.log.join(String.fromCharCode(10)));
      return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null;
    };
    const out: Record<string, unknown> = {};
    for (const variant of ['hap', 'hapq']) {
      const input = { info, edits: edits.defaultEdits(), settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video' }, convert: { videoFormat: 'hap', hapVariant: variant } }) };
      const assessed = await engine.assess(clip, input);
      const done = await engine.process(variant, clip, input).result;
      const file = new File([done.blob], 'x.mov');
      out[variant] = { assessed, extension: done.extension, info: await engine.probe(file), psnr: await psnr(file), size: done.blob.size, release: done.release !== undefined };
      await done.release?.();
    }

    // A mix of two clips with a crossfade, in Hap Q.
    const files = [clip, clip];
    const infos = [info, info];
    const clips = files.map((_, i) => ({ clip: { id: `c${i}`, fileId: `f${i}`, kind: 'video', transitionIn: null }, info: infos[i], edits: edits.defaultEdits(), settings: settings.defaultSettings(), silences: null }));
    const base = timeline.defaultMix();
    const mixIn = { clips, files, mix: { ...base, kind: 'video', transition: { duration: 1, curve: 'tri', cut: false, style: 'dissolve' }, video: { ...base.video, format: 'hap', hapVariant: 'hapq' } }, measured: new Map() };
    const mixed = await engine.mix('mix', mixIn).result;
    out.mix = { info: await engine.probe(new File([mixed.blob], 'mix.mov')), extension: mixed.extension, assessed: await engine.assessMix(mixIn) };
    await mixed.release?.();

    // Without a decoder HAP has no way: nothing is assessed and the job says why, whatever the engine setting.
    const saved = (globalThis as any).VideoDecoder;
    delete (globalThis as any).VideoDecoder;
    try {
      mode.value = 'ffmpeg';
      const input = { info, edits: edits.defaultEdits(), settings: settings.effectiveSettings(settings.defaultSettings(), { extract: { kind: 'video' }, convert: { videoFormat: 'hap' } }) };
      out.noDecoder = {
        assessed: await engine.assess(clip, input),
        failure: await engine.process('nodec', clip, input).result.then(
          () => 'ok',
          (e: { code: string; detail: string }) => `${e.code} ${e.detail}`,
        ),
      };
    } finally {
      (globalThis as any).VideoDecoder = saved;
      mode.value = 'auto';
    }
    return out;
  });
  const video = (i: Probed) => i.tracks.find((t) => t.kind === 'video')!;
  const audio = (i: Probed) => i.tracks.find((t) => t.kind === 'audio');
  for (const v of ['hap', 'hapq'] as const) {
    const x = r[v] as { assessed: { backend: string }; extension: string; info: Probed; psnr: number; size: number; release: boolean };
    console.log(`${v}: psnr ${x.psnr} size ${x.size}`);
    expect(x.assessed.backend, v).toBe('hap');
    expect(x.extension, v).toBe('mov');
    expect(x.release, v).toBe(true);
    expect(video(x.info).codec, v).toBe('hap');
    expect([video(x.info).width, video(x.info).height], v).toEqual([320, 180]);
    expect(audio(x.info)?.codec, v).toMatch(/^pcm_/);
    expect(x.info.duration, v).toBeCloseTo(3, 0);
    expect(x.psnr, v).toBeGreaterThan(24);
  }
  const mix = r.mix as { info: Probed; extension: string; assessed: { backend: string } };
  expect(mix.assessed.backend).toBe('hap');
  expect(mix.extension).toBe('mov');
  expect(video(mix.info).codec).toBe('hap');
  expect(audio(mix.info)?.codec).toMatch(/^pcm_/);
  // 3 + 3 s with the crossfade taken out.
  expect(mix.info.duration).toBeCloseTo(5, 0);
  const none = r.noDecoder as { assessed: { backend: null }; failure: string };
  expect(none.assessed.backend).toBeNull();
  expect(none.failure).toBe('invalid-input hap-needs-decoder');
});
