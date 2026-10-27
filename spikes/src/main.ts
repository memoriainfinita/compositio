import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';

type Result = { ok: boolean; ms?: number; [k: string]: unknown };
const results: Record<string, Result> = {};
const out = document.getElementById('out')!;
const base = new URL('.', location.href).href;

function show() {
  out.textContent = JSON.stringify(results, null, 2);
}

// --- helpers ---

function makeWav(seconds: number, freq: number, sr = 44100, ch = 2): Blob {
  const frames = Math.round(seconds * sr);
  const dataBytes = frames * ch * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  const pcm = new Int16Array(buf, 44);
  const w = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin(w * i) * 8000);
    for (let c = 0; c < ch; c++) pcm[i * ch + c] = s;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function loadFF(mt: boolean): Promise<{ ff: FFmpeg; logs: string[] }> {
  const ff = new FFmpeg();
  const logs: string[] = [];
  ff.on('log', ({ message }) => logs.push(message));
  const dir = `${base}ffmpeg/${mt ? 'mt' : 'st'}/`;
  await ff.load({
    coreURL: `${dir}ffmpeg-core.js`,
    wasmURL: `${dir}ffmpeg-core.wasm`,
    ...(mt ? { workerURL: `${dir}ffmpeg-core.worker.js` } : {}),
  });
  return { ff, logs };
}

async function run(name: string, fn: () => Promise<Omit<Result, 'ok'> | void>, timeoutMs = 180000) {
  const t0 = performance.now();
  results[name] = { ok: false, running: true };
  show();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${timeoutMs} ms`)), timeoutMs)),
    ]);
    results[name] = { ok: true, ms: Math.round(performance.now() - t0), ...(r || {}) };
  } catch (e) {
    results[name] = { ok: false, ms: Math.round(performance.now() - t0), error: String((e as Error)?.message ?? e) };
  }
  show();
}

function listed(logs: string[], names: string[]): Record<string, boolean> {
  const text = logs.join('\n');
  return Object.fromEntries(names.map((n) => [n, new RegExp(`^\\s*\\S+\\s+${n}\\s`, 'm').test(text)]));
}

// --- tests ---

const tests: Record<string, () => Promise<void>> = {
  async env() {
    await run('env', async () => ({
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      hardwareConcurrency: navigator.hardwareConcurrency,
      swControlled: !!navigator.serviceWorker?.controller,
      wakeLockApi: 'wakeLock' in navigator,
      showSaveFilePicker: 'showSaveFilePicker' in self,
      storage: await navigator.storage?.estimate?.().then((e) => ({ quotaMB: Math.round((e.quota ?? 0) / 1e6) })),
      deviceMemory: (navigator as any).deviceMemory ?? null,
      ua: navigator.userAgent,
    }));
  },

  async capabilities() {
    await run('capabilities', async () => {
      const { ff, logs } = await loadFF(false);
      await ff.exec(['-hide_banner', '-version']);
      const version = logs.find((l) => l.startsWith('ffmpeg version')) ?? logs[0];
      const config = logs.find((l) => l.startsWith('configuration:')) ?? '';
      logs.length = 0;
      await ff.exec(['-hide_banner', '-encoders']);
      const encoders = listed(logs, ['libmp3lame', 'aac', 'libopus', 'opus', 'libvorbis', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'alac', 'libx264', 'libx265', 'libvpx-vp9', 'prores', 'prores_ks', 'hap', 'mjpeg', 'png']);
      logs.length = 0;
      await ff.exec(['-hide_banner', '-filters']);
      const filters = listed(logs, ['acrossfade', 'afade', 'loudnorm', 'ebur128', 'silencedetect', 'silenceremove', 'aresample', 'aformat', 'atempo', 'rubberband', 'highpass', 'lowpass', 'afftdn', 'anlmdn', 'volume', 'apad', 'atrim', 'channelsplit', 'pan', 'amix', 'concat', 'xfade', 'scale', 'crop', 'transpose', 'fps', 'fade', 'showwavespic']);
      logs.length = 0;
      await ff.exec(['-hide_banner', '-muxers']);
      const muxers = listed(logs, ['wav', 'flac', 'mp3', 'ipod', 'mp4', 'mov', 'ogg', 'opus', 'adts', 'matroska', 'image2']);
      logs.length = 0;
      await ff.exec(['-hide_banner', '-h', 'filter=aresample']);
      const soxr = /resampler/.test(logs.join('\n')) && config.includes('libsoxr');
      ff.terminate();
      return { version, config, encoders, filters, muxers, soxr };
    });
  },

  async loadMt() {
    await run('loadMt', async () => {
      if (!self.crossOriginIsolated) throw new Error('not crossOriginIsolated');
      const { ff, logs } = await loadFF(true);
      await ff.exec(['-hide_banner', '-version']);
      ff.terminate();
      return { version: logs[0] };
    }, 60000);
  },

  async bench() {
    const jobs: [string, string[]][] = [
      ['mp3_120s', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=120:sample_rate=44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', 'o.mp3']],
      ['loudnorm_120s', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=120:sample_rate=44100', '-af', 'loudnorm=I=-14:print_format=json', '-f', 'null', '-']],
      ['x264_720p_5s', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-c:v', 'libx264', '-preset', 'veryfast', 'o.mp4']],
    ];
    for (const mt of [false, true]) {
      if (mt && !self.crossOriginIsolated) { results.bench_mt = { ok: false, error: 'not crossOriginIsolated' }; continue; }
      await run(`bench_${mt ? 'mt' : 'st'}`, async () => {
        const times: Record<string, unknown> = {};
        for (const [name, args] of jobs) {
          // fresh instance per job so one crash does not hide the others
          const { ff, logs } = await loadFF(mt);
          const t = performance.now();
          try {
            const code = await ff.exec(['-hide_banner', '-y', ...args], 120000);
            times[name] = code === 0 ? Math.round(performance.now() - t) : { exit: code, log: logs.slice(-3) };
          } catch (e) {
            times[name] = { threw: String((e as Error)?.message ?? JSON.stringify(e)), log: logs.slice(-4) };
          }
          ff.terminate();
        }
        return { times };
      }, 400000);
    }
  },

  async x264mt() {
    await run('x264mt', async () => {
      const res: Record<string, unknown> = {};
      for (const extra of [['-threads', '1'], ['-threads', '2'], ['-x264-params', 'threads=4:lookahead_threads=1']]) {
        const { ff, logs } = await loadFF(true);
        const t = performance.now();
        try {
          const code = await ff.exec(['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-c:v', 'libx264', '-preset', 'veryfast', ...extra, 'o.mp4'], 120000);
          res[extra.join(' ')] = code === 0 ? Math.round(performance.now() - t) : { exit: code, log: logs.slice(-2) };
        } catch (e) {
          res[extra.join(' ')] = { threw: String((e as Error)?.message ?? e) };
        }
        ff.terminate();
      }
      return res;
    }, 400000);
  },

  async workerfs() {
    await run('workerfs', async () => {
      const { ff, logs } = await loadFF(false);
      const big = new File([makeWav(600, 220)], 'Canción 01 – larga.wav');
      const small = new File([makeWav(10, 440)], 'b.wav');
      await ff.createDir('/in');
      await ff.mount(FFFSType.WORKERFS, { files: [big, small] }, '/in');
      const ls = (await ff.listDir('/in')).map((e) => e.name);
      const t = performance.now();
      const code = await ff.exec(['-hide_banner', '-y', '-ss', '500', '-i', `/in/${big.name}`, '-t', '5', 'cut.wav']);
      const seekMs = Math.round(performance.now() - t);
      const outBytes = (await ff.readFile('cut.wav') as Uint8Array).byteLength;
      const t2 = performance.now();
      const code2 = await ff.exec(['-hide_banner', '-y', '-i', `/in/${big.name}`, '-c:a', 'libmp3lame', '-b:a', '128k', 'full.mp3']);
      const fullMs = Math.round(performance.now() - t2);
      await ff.unmount('/in');
      // remount with other files on the same point
      await ff.mount(FFFSType.WORKERFS, { files: [small] }, '/in');
      const ls2 = (await ff.listDir('/in')).map((e) => e.name);
      await ff.unmount('/in');
      ff.terminate();
      return { inputMB: Math.round(big.size / 1e6), ls, code, seekMs, outBytes, code2, fullMs, ls2, lastLog: logs.slice(-2) };
    }, 300000);
  },

  async filtergraph() {
    await run('filtergraph', async () => {
      const { ff, logs } = await loadFF(false);
      const files = [0, 1, 2].map((i) => new File([makeWav(8, 220 * (i + 1), i === 1 ? 48000 : 44100, i === 2 ? 1 : 2)], `t${i}.wav`));
      await ff.createDir('/in');
      await ff.mount(FFFSType.WORKERFS, { files }, '/in');
      const inputs = files.flatMap((f) => ['-i', `/in/${f.name}`]);
      const norm = files.map((_, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[n${i}]`).join(';');
      const graph = `${norm};[n0][n1]acrossfade=d=2[x1];[x1][n2]acrossfade=d=2[out]`;
      await ff.writeFile('/graph.txt', new TextEncoder().encode(graph));
      const variants: Record<string, string[]> = {
        slashOption: ['-/filter_complex', '/graph.txt'],
        scriptOption: ['-filter_complex_script', '/graph.txt'],
        inline: ['-filter_complex', graph],
      };
      const res: Record<string, unknown> = {};
      for (const [k, opt] of Object.entries(variants)) {
        logs.length = 0;
        const code = await ff.exec(['-hide_banner', '-y', ...inputs, ...opt, '-map', '[out]', `${k}.wav`]);
        res[k] = code === 0 ? { code, bytes: (await ff.readFile(`${k}.wav`) as Uint8Array).byteLength } : { code, log: logs.slice(-3) };
      }
      // long inline graph: 60 inputs chained
      const n = 60;
      const many = Array.from({ length: n }, () => ['-i', '/in/t0.wav']).flat();
      let g = Array.from({ length: n }, (_, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[n${i}]`).join(';');
      let prev = 'n0';
      for (let i = 1; i < n; i++) { g += `;[${prev}][n${i}]acrossfade=d=1[x${i}]`; prev = `x${i}`; }
      logs.length = 0;
      const t = performance.now();
      const code = await ff.exec(['-hide_banner', '-y', ...many, '-filter_complex', g, '-map', `[${prev}]`, '-c:a', 'libmp3lame', 'long.mp3']);
      res.inline60 = { code, graphChars: g.length, ms: Math.round(performance.now() - t), log: code ? logs.slice(-3) : undefined };
      await ff.unmount('/in');
      ff.terminate();
      return res;
    }, 300000);
  },

  async cancel() {
    await run('cancel', async () => {
      const { ff } = await loadFF(false);
      const p = ff.exec(['-hide_banner', '-f', 'lavfi', '-i', 'sine=duration=3600', '-c:a', 'libmp3lame', 'x.mp3']);
      await new Promise((r) => setTimeout(r, 1500));
      ff.terminate();
      const rejected = await p.then(() => 'resolved', (e) => `rejected: ${e?.message ?? e}`);
      const t = performance.now();
      const again = await loadFF(false);
      const code = await again.ff.exec(['-hide_banner', '-version']);
      again.ff.terminate();
      return { rejected, reloadMs: Math.round(performance.now() - t), code };
    });
  },

  async wakelock() {
    await run('wakelock', async () => {
      if (!('wakeLock' in navigator)) throw new Error('no navigator.wakeLock');
      const s = await (navigator as any).wakeLock.request('screen');
      const r = { type: s.type, released: s.released };
      await s.release();
      return { ...r, releasedAfter: s.released };
    }, 15000);
  },

  async download() {
    await run('download', async () => {
      for (const [i, name] of ['uno.wav', 'Canción 02.wav', 'tres.wav'].entries()) {
        const url = URL.createObjectURL(makeWav(1 + i, 440));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        await new Promise((r) => setTimeout(r, 300));
      }
      return { triggered: 3 };
    });
  },

  async zip() {
    const entries = [
      { name: 'Canción 01.wav', blob: makeWav(30, 440) },
      { name: 'dos.wav', blob: makeWav(5, 220) },
    ];
    const totalMB = +(entries.reduce((s, e) => s + e.blob.size, 0) / 1e6).toFixed(1);
    const { unzipSync } = await import('fflate');
    const verify = async (blob: Blob) => {
      const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.byteLength]));
    };
    const zips: Record<string, Blob> = {};

    await run('zip_fflate', async () => {
      const { zip } = await import('fflate');
      const input: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (const e of entries) input[e.name] = [new Uint8Array(await e.blob.arrayBuffer()), { level: 0 }];
      const data = await new Promise<Uint8Array>((res, rej) => zip(input, (err, d) => (err ? rej(err) : res(d))));
      zips.fflate = new Blob([data]);
      return { totalMB, zipMB: +(data.byteLength / 1e6).toFixed(1), contents: await verify(zips.fflate) };
    });

    await run('zip_clientzip', async () => {
      const { downloadZip } = await import('client-zip');
      const blob = await downloadZip(entries.map((e) => ({ name: e.name, input: e.blob, lastModified: new Date() }))).blob();
      zips.clientzip = blob;
      return { totalMB, zipMB: +(blob.size / 1e6).toFixed(1), contents: await verify(blob) };
    });

    await run('zip_zipjs', async () => {
      const { ZipWriter, BlobWriter, BlobReader, configure } = await import('@zip.js/zip.js');
      configure({ useWebWorkers: false });
      const w = new ZipWriter(new BlobWriter('application/zip'), { level: 0 });
      for (const e of entries) await w.add(e.name, new BlobReader(e.blob));
      const blob = await w.close();
      zips.zipjs = blob;
      return { totalMB, zipMB: +(blob.size / 1e6).toFixed(1), contents: await verify(blob) };
    });

    for (const [k, blob] of Object.entries(zips)) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `spike-${k}.zip` });
      document.body.append(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 300));
    }
  },
};

// --- ui ---

const buttons = document.getElementById('buttons')!;
for (const name of Object.keys(tests)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => tests[name]();
  buttons.append(b);
}

const params = new URLSearchParams(location.search);
const auto = params.get('run');
(window as any).__results = results;
if (auto) {
  (async () => {
    // coi-serviceworker reloads the page on first visit; wait for it instead of racing it
    if (!self.crossOriginIsolated && navigator.serviceWorker) await new Promise((r) => setTimeout(r, 8000));
    const names = auto === 'all' ? Object.keys(tests) : auto.split(',');
    for (const n of names) await tests[n]();
    (window as any).__done = true;
    document.title = 'done';
  })();
}
show();
