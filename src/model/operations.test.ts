import { describe, expect, it } from 'vitest';
import { defaultEdits, type FileEdits } from './edits.ts';
import { media, mp3, track } from './fixtures.ts';
import type { MediaInfo } from './media.ts';
import { OPERATIONS, parseMeasurement, plan, type JobPlan, type PlanInput } from './operations.ts';
import { defaultSettings, effectiveSettings, type Overrides } from './settings.ts';

const input = (info: MediaInfo, own: Overrides = {}, edits: Partial<FileEdits> = {}): PlanInput => ({
  info,
  edits: { ...defaultEdits(), ...edits },
  settings: effectiveSettings(defaultSettings(), own),
  inputPath: '/in/song',
  outputPath: '/out/result',
});

const ok = (p: ReturnType<typeof plan>): JobPlan => {
  if ('error' in p) throw new Error(p.error);
  return p;
};

const render = (p: JobPlan, m?: Parameters<JobPlan['render']>[0]): string => {
  const args = p.render(m);
  if (!Array.isArray(args)) throw new Error(args.error);
  return args.join(' ');
};

describe('OPERATIONS', () => {
  it('follows the fixed order of «Salida»', () => {
    expect(OPERATIONS.map((o) => o.id)).toEqual(['extract', 'trim', 'normalize', 'convert', 'output']);
  });
});

describe('plan', () => {
  it('converts the whole file with the defaults', () => {
    const p = ok(plan(input(media())));
    expect(p.measure).toBeNull();
    expect(p.extension).toBe('wav');
    expect(render(p)).toBe('-hide_banner -nostdin -y -i /in/song -map 0:a:0 -c:a pcm_s24le -map_metadata 0 -f wav /out/result');
  });

  it('trims with input seeking and fades relative to the kept part', () => {
    const p = ok(plan(input(media(), {}, { in: 10, out: 40, fadeIn: { duration: 2, curve: 'qsin' }, fadeOut: { duration: 3, curve: 'tri' } })));
    expect(render(p)).toContain('-ss 10.000000 -t 30.000000 -i /in/song');
    expect(render(p)).toContain('-af afade=t=in:st=0:d=2.000000:curve=qsin,afade=t=out:st=27.000000:d=3.000000:curve=tri');
  });

  it('cuts the detected silences only when asked', () => {
    const base = { ...input(media()), silences: { head: 1.5, tail: 110 } };
    expect(render(ok(plan(base)))).not.toContain('-ss');
    const s = { ...base, settings: effectiveSettings(defaultSettings(), { trim: { silence: true } }) };
    expect(render(ok(plan(s)))).toContain('-ss 1.500000 -t 108.500000');
  });

  it('copies MP3 without re-encoding when nothing else changes', () => {
    const p = ok(plan(input(mp3(), { trim: { lossless: true }, convert: { format: 'mp3' } }, { in: 5 })));
    expect(p.warnings).toEqual([]);
    expect(p.extension).toBe('mp3');
    expect(render(p)).toBe('-hide_banner -nostdin -y -ss 5.000000 -t 115.000000 -i /in/song -map 0:a:0 -c:a copy -map_metadata 0 -id3v2_version 3 -f mp3 /out/result');
  });

  it('falls back to encoding when a lossless trim is not possible', () => {
    const p = ok(plan(input(mp3(), { trim: { lossless: true }, convert: { format: 'mp3' } }, { fadeIn: { duration: 1, curve: 'tri' } })));
    expect(p.warnings).toEqual(['lossless-unavailable', 'lossy-reencode']);
    expect(render(p)).toContain('-c:a libmp3lame -b:a 320k');
  });

  it('extracts the chosen track as it is from a video', () => {
    const info = media({
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      tracks: [
        { kind: 'video', index: 0, codec: 'h264', width: 1920, height: 1080, fps: { num: 25, den: 1 }, rotation: 0 },
        track({ codec: 'aac', index: 0, bitDepth: undefined }),
        track({ codec: 'aac', index: 1, bitDepth: undefined }),
      ],
    });
    const p = ok(plan(input(info, { extract: { mode: 'copy', track: 1 } })));
    expect(p.extension).toBe('m4a');
    expect(render(p)).toBe('-hide_banner -nostdin -y -i /in/song -map 0:a:1 -c:a copy -map_metadata 0 -f ipod /out/result');
  });

  it('normalizes to LUFS in two passes', () => {
    const p = ok(plan(input(media(), { normalize: { enabled: true } })));
    expect(p.measure?.kind).toBe('loudnorm');
    expect(p.measure?.args.join(' ')).toBe('-hide_banner -nostdin -y -i /in/song -map 0:a:0 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -');
    expect(p.render()).toEqual({ error: 'missing-measurement' });
    const m = { kind: 'loudnorm' as const, i: -20.1, tp: -3.2, lra: 7.5, thresh: -30.4, offset: 0.3 };
    expect(render(p, m)).toContain(
      '-af loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-20.1:measured_TP=-3.2:measured_LRA=7.5:measured_thresh=-30.4:offset=0.3:linear=true:print_format=summary,aresample=48000',
    );
  });

  it('normalizes to peak with the measured maximum', () => {
    const p = ok(plan(input(media(), { normalize: { enabled: true, mode: 'peak', peak: -1 } })));
    expect(p.measure?.args).toContain('volumedetect');
    expect(render(p, { kind: 'volume', maxVolume: -6.5 })).toContain('-af volume=5.50dB,aresample=48000');
    expect(p.render({ kind: 'volume', maxVolume: -Infinity })).toEqual({ error: 'silent-input' });
  });

  it('dithers when going down to 16 bits', () => {
    const p = ok(plan(input(media(), { convert: { bitDepth: 16 } })));
    expect(render(p)).toContain('-af aresample=48000:osf=s16:dither_method=triangular -c:a pcm_s16le');
    const plain = ok(plan(input(media({ tracks: [track({ bitDepth: 16 })] }), { convert: { bitDepth: 16 } })));
    expect(render(plain)).not.toContain('aresample');
  });

  it('keeps each format within the rates its codec accepts', () => {
    const opus = ok(plan(input(mp3(), { convert: { format: 'opus' } })));
    expect(render(opus)).toContain('-af aresample=48000 -c:a libopus -b:a 160k');
    expect(opus.warnings).toEqual(['lossy-reencode', 'rate-adjusted']);
    const hiRes = ok(plan(input(media({ tracks: [track({ sampleRate: 96000 })] }), { convert: { format: 'mp3', mp3: { mode: 'vbr' } } as never })));
    expect(render(hiRes)).toContain('-af aresample=48000 -c:a libmp3lame -q:a 0');
  });

  it('writes FLAC, AAC and OGG with their options', () => {
    expect(render(ok(plan(input(media(), { convert: { format: 'flac' } }))))).toContain('-c:a flac -sample_fmt s32 -bits_per_raw_sample 24');
    expect(render(ok(plan(input(media(), { convert: { format: 'aac', channels: 1 } }))))).toContain('-ac 1 -c:a aac -b:a 256k -map_metadata 0 -f ipod');
    expect(render(ok(plan(input(media(), { convert: { format: 'ogg' } }))))).toContain('-c:a libvorbis -q:a 6');
  });

  it('carries the cover art and tags, or drops them', () => {
    const withCover = mp3({ hasCover: true });
    expect(render(ok(plan(input(withCover, { convert: { format: 'mp3' } }))))).toBe(
      '-hide_banner -nostdin -y -i /in/song -map 0:a:0 -map 0:v:0? -c:a libmp3lame -b:a 320k -c:v copy -disposition:v:0 attached_pic -map_metadata 0 -id3v2_version 3 -f mp3 /out/result',
    );
    expect(render(ok(plan(input(withCover, { trim: { lossless: true }, convert: { format: 'mp3' } }, { in: 2 }))))).toContain(
      '-map 0:a:0 -map 0:v:0? -c:a copy -c:v copy -disposition:v:0 attached_pic',
    );
    expect(render(ok(plan(input(withCover, { convert: { format: 'wav' } }))))).not.toContain('0:v');
    expect(render(ok(plan(input(withCover, { convert: { keepMetadata: false } }))))).toContain('-map_metadata -1');
  });

  it('refuses files it cannot process', () => {
    expect(plan(input(media({ tracks: [] })))).toEqual({ error: 'no-audio-track' });
    expect(plan(input(media(), {}, { in: 50, out: 20 }))).toEqual({ error: 'empty-range' });
  });
});

describe('parseMeasurement', () => {
  it('reads the loudnorm JSON from ffmpeg stderr', () => {
    const stderr = `size=N/A time=00:02:00.00 bitrate=N/A speed= 120x
[Parsed_loudnorm_0 @ 0x1a2b3c]
{
	"input_i" : "-20.12",
	"input_tp" : "-3.25",
	"input_lra" : "7.50",
	"input_thresh" : "-30.41",
	"output_i" : "-14.02",
	"output_tp" : "-1.50",
	"output_lra" : "6.90",
	"output_thresh" : "-24.30",
	"normalization_type" : "dynamic",
	"target_offset" : "0.02"
}
`;
    expect(parseMeasurement('loudnorm', stderr)).toEqual({ kind: 'loudnorm', i: -20.12, tp: -3.25, lra: 7.5, thresh: -30.41, offset: 0.02 });
  });

  it('reads silence as minus infinity and volumedetect peaks', () => {
    const silent = '[Parsed_loudnorm_0 @ 0x1]\n{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-inf", "target_offset" : "inf" }';
    expect(parseMeasurement('loudnorm', silent)).toMatchObject({ i: -Infinity });
    expect(parseMeasurement('volume', '[Parsed_volumedetect_0 @ 0x1] max_volume: -6.5 dB')).toEqual({ kind: 'volume', maxVolume: -6.5 });
    expect(parseMeasurement('volume', 'nothing here')).toBeNull();
  });
});
