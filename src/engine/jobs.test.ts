import { describe, expect, it } from 'vitest';
import { defaultEdits } from '../model/edits.ts';
import { clip, media, videoTrack } from '../model/fixtures.ts';
import { defaultSettings, effectiveSettings } from '../model/settings.ts';
import { detectSilences, extractFrame, probeFile, processFile } from './jobs.ts';
import type { RunOptions, RunRequest, RunResult, Runner } from './runner.ts';
import wav from './fixtures/probe-tone-wav.json';

/** Answers each run with the next scripted result and records the requests. */
function fakeRunner(...results: ((req: RunRequest, o?: RunOptions) => Partial<RunResult>)[]): Runner & { requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  return {
    requests,
    async run(req, o) {
      requests.push(req);
      const next = results.shift();
      if (!next) throw new Error('unexpected run');
      return { code: 0, log: [], files: new Map(), ...next(req, o) };
    },
    dispose() {},
  };
}

const file = new File(['x'], 'canción.wav');

describe('jobs', () => {
  it('probes with ffprobe into a JSON output', async () => {
    const runner = fakeRunner(() => ({ files: new Map([['probe.json', new Blob([JSON.stringify(wav)])]]) }));
    const info = await probeFile(runner, file);
    expect(info.duration).toBe(20);
    expect(runner.requests[0]).toMatchObject({ tool: 'ffprobe', outputs: ['probe.json'] });
    expect(runner.requests[0]?.args.slice(-3)).toEqual(['/in/0/canción.wav', '-o', '/out/probe.json']);
  });

  it('decodes to find the duration when the file does not say it', async () => {
    const noDuration = { ...wav, format: { ...wav.format, duration: undefined }, streams: wav.streams.map((s) => ({ ...s, duration: undefined })) };
    const runner = fakeRunner(
      () => ({ files: new Map([['probe.json', new Blob([JSON.stringify(noDuration)])]]) }),
      () => ({ log: ['size=N/A time=00:00:01.00 bitrate=N/A', 'size=N/A time=00:00:02.48 bitrate=N/A'] }),
    );
    expect((await probeFile(runner, file)).duration).toBe(2.48);
    expect(runner.requests[1]?.args.slice(-3)).toEqual(['null', '-f', 'null', '-'].slice(-3));
  });

  it('turns a failed command into an engine error', async () => {
    const runner = fakeRunner(() => ({ code: 1, log: ['Invalid data found when processing input'] }));
    await expect(probeFile(runner, file)).rejects.toMatchObject({ code: 'ffmpeg-failed' });
  });

  it('detects silences on the chosen track', async () => {
    const runner = fakeRunner(() => ({ log: ['silence_start: 0', 'silence_end: 0.8 | silence_duration: 0.8'] }));
    expect(await detectSilences(runner, file, media(), 0)).toEqual({ head: 0.8, tail: 120 });
    expect(runner.requests[0]?.args).toContain('silencedetect=n=-60dB:d=0.1');
  });

  it('measures, then renders with the measurement, and reports progress across both passes', async () => {
    const loud = '{ "input_i" : "-20.00", "input_tp" : "-3.00", "input_lra" : "5.00", "input_thresh" : "-30.00", "target_offset" : "0.10" }';
    const runner = fakeRunner(
      (_, o) => {
        o?.onProgress?.(1);
        return { log: ['[Parsed_loudnorm_0 @ 0x1]', loud] };
      },
      (req, o) => {
        o?.onProgress?.(0.5);
        expect(req.args.join(' ')).toContain('measured_I=-20');
        return { files: new Map([['result', new Blob(['ok'])]]) };
      },
    );
    const seen: number[] = [];
    const settings = effectiveSettings(defaultSettings(), { normalize: { enabled: true } });
    const r = await processFile(runner, file, { info: media(), edits: { ...defaultEdits(), in: 20 }, settings }, { onProgress: (x) => seen.push(x) });
    expect(r.extension).toBe('wav');
    expect(await r.blob.text()).toBe('ok');
    expect(r.measurement).toMatchObject({ kind: 'loudnorm', i: -20 });
    expect(seen.map((x) => Number(x.toFixed(6)))).toEqual([0.3, 0.65, 1]);
    expect(runner.requests.map((q) => q.duration)).toEqual([100, 100]);
  });

  it('refuses a file the plan cannot process before running anything', async () => {
    const runner = fakeRunner();
    await expect(processFile(runner, file, { info: media({ tracks: [] }), edits: defaultEdits(), settings: defaultSettings() })).rejects.toMatchObject({
      code: 'invalid-input',
      detail: 'no-audio-track',
    });
    expect(runner.requests).toEqual([]);
  });
});

describe('jobs, video', () => {
  const clipFile = new File(['v'], 'clip.mp4');
  const other = new File(['a'], 'voz.wav');
  const base = (over: Parameters<typeof effectiveSettings>[1] = {}) => ({
    info: clip(),
    edits: defaultEdits(),
    settings: effectiveSettings(defaultSettings(), { extract: { kind: 'video' }, ...over }),
  });
  const out = () => ({ files: new Map([['result', new Blob(['o'])]]) });

  it('asks for the multithread core and counts progress in output seconds', async () => {
    const runner = fakeRunner(out);
    const own = { picture: { speed: 2 as const } };
    await processFile(runner, clipFile, { ...base(own), encoderThreads: 2 });
    expect(runner.requests[0]).toMatchObject({ core: 'mt', duration: 60 });
    expect(runner.requests[0]?.args).toContain('-threads');
  });

  it('keeps the single-thread core when no threads were given', async () => {
    const runner = fakeRunner(out);
    await processFile(runner, clipFile, base());
    expect(runner.requests[0]?.core).toBe('st');
  });

  it('mounts the replacement sound as the second input', async () => {
    const runner = fakeRunner(out);
    const own = { extract: { kind: 'video' as const, audio: 'replace' as const, replaceWith: { fileId: 'b', track: 0 } } };
    await processFile(runner, clipFile, { ...base(own), replacement: { file: other, info: media() } });
    expect(runner.requests[0]?.inputs).toEqual([clipFile, other]);
    expect(runner.requests[0]?.args).toContain('/in/1/voz.wav');
  });

  it('takes a frame as an image', async () => {
    const runner = fakeRunner(() => ({ files: new Map([['frame.png', new Blob(['p'])]]) }));
    const blob = await extractFrame(runner, clipFile, { video: videoTrack(), time: 2, format: 'png' });
    expect(blob.type).toBe('image/png');
    expect(runner.requests[0]?.args).toContain('/out/frame.png');
  });
});
