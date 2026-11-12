import { describe, expect, it } from 'vitest';
import { defaultEdits, type FileEdits } from './edits.ts';
import { clip, media, mp3, track, videoTrack } from './fixtures.ts';
import type { MediaInfo } from './media.ts';
import { frameArgs, OPERATIONS, parseMeasurement, plan, type JobPlan, type PlanInput } from './operations.ts';
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
    expect(OPERATIONS.map((o) => o.id)).toEqual(['extract', 'trim', 'picture', 'normalize', 'convert', 'output']);
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
      '-af loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-20.1:measured_TP=-3.2:measured_LRA=7.5:measured_thresh=-30.4:offset=0.3:linear=true:print_format=summary,aresample=48000,aformat=channel_layouts=stereo',
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

describe('plan, video', () => {
  const video = { extract: { kind: 'video' as const } };

  it('refuses a file without picture', () => {
    expect(plan(input(media(), video))).toEqual({ error: 'no-video-track' });
  });

  it('encodes H.264 with the sound kept and a constant rate', () => {
    const p = ok(plan(input(clip(), video)));
    expect(p.extension).toBe('mp4');
    expect(p.outputDuration).toBe(120);
    const cmd = render(p);
    expect(cmd).toContain('-map 0:v:0 -map 0:a:0');
    expect(cmd).toContain('-vf fps=25/1');
    expect(cmd).toContain('-c:v libx264 -preset veryfast -crf 18 -profile:v high -pix_fmt yuv420p -fps_mode cfr');
    expect(cmd).toContain('-movflags +faststart -f mp4');
  });

  it('gives the encoder its threads only when told to', () => {
    expect(render(ok(plan({ ...input(clip(), video), encoderThreads: 2 })))).toContain('-threads 2');
    expect(render(ok(plan(input(clip(), video))))).not.toContain('-threads');
  });

  it('chains the picture in order and keeps the sound in step with the speed', () => {
    const own = { ...video, picture: { rotate: 90 as const, scale: { mode: 'fit' as const, width: 1280, height: 720 }, speed: 4 } };
    const p = ok(plan(input(clip(), own, { fadeIn: { duration: 2, curve: 'tri' } })));
    const cmd = render(p);
    expect(cmd).toContain('-vf transpose=1,scale=w=1280:h=720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fade=t=in:st=0:d=2.000000,setpts=PTS/4,fps=25/1');
    expect(cmd).toContain('-af afade=t=in:st=0:d=2.000000:curve=tri,atempo=2,atempo=2');
    expect(p.outputDuration).toBe(30);
  });

  it('puts the file\'s rotation into the size it fits', () => {
    const p = ok(plan(input(clip({}, { rotation: 90 }), { ...video, picture: { scale: { mode: 'letterbox', width: 1920, height: 1080 } } })));
    expect(render(p)).toContain('scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1');
  });

  it('makes odd sizes even and says so', () => {
    const p = ok(plan(input(clip({}, { width: 1279, height: 719 }), video)));
    expect(render(p)).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    expect(p.warnings).toContain('size-rounded');
  });

  it('refuses a crop outside the picture', () => {
    expect(plan(input(clip(), { ...video, picture: { crop: { x: 1000, y: 0, width: 1000, height: 100 } } }))).toEqual({ error: 'crop-outside-frame' });
  });

  it('writes ProRes into a mov, with alpha only for 4444 sources that have it', () => {
    const own = { ...video, convert: { videoFormat: 'prores' as const, proresProfile: '4444' as const } };
    const p = ok(plan(input(clip({}, { pixelFormat: 'yuva444p' }), own)));
    expect(p.extension).toBe('mov');
    expect(render(p)).toContain('-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le -fps_mode cfr');
    expect(render(ok(plan(input(clip(), own))))).toContain('-pix_fmt yuv444p10le');
    expect(render(ok(plan(input(clip(), { ...video, convert: { videoFormat: 'prores' } }))))).toContain('-profile:v 3 -pix_fmt yuv422p10le');
  });

  it('plans HAP for the browser: a mov, sizes of 4, the sound as PCM in a WAV, and no ffmpeg render', () => {
    const own = { ...video, convert: { videoFormat: 'hap' as const, hapVariant: 'hapq' as const, bitDepth: 24 as const } };
    const p = ok(plan(input(clip({}, { width: 1279, height: 719 }), own)));
    expect(p.extension).toBe('mov');
    expect(p.video).toMatchObject({ codec: 'hap', hapVariant: 'hapq', portable: false, picture: { size: { width: 1276, height: 716 } } });
    expect(p.warnings).toContain('size-rounded');
    expect(p.render()).toEqual({ error: 'hap-needs-decoder' });
    const sound = p.renderAudio() as string[];
    expect(sound).toEqual(expect.arrayContaining(['-c:a', 'pcm_s24le', '-f', 'wav']));
    expect(sound).not.toContain('-c:v');
  });

  it('warns when ProRes would not fit in memory', () => {
    const own = { ...video, convert: { videoFormat: 'prores' as const, proresProfile: '4444' as const } };
    expect(ok(plan(input(clip({ duration: 3600 }), own))).warnings).toContain('output-may-not-fit');
    expect(ok(plan(input(clip({ duration: 10 }), own))).warnings).not.toContain('output-may-not-fit');
  });

  it('drops the sound, or puts silence of the right length in its place', () => {
    expect(render(ok(plan(input(clip(), { extract: { kind: 'video', audio: 'none' } }))))).toMatch(/-map 0:v:0 -vf .* -c:v .* -an /);
    const s = ok(plan(input(clip(), { extract: { kind: 'video', audio: 'silence' } })));
    expect(render(s)).toContain('-f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v:0 -map 1:a:0');
    expect(render(s)).toContain('-t 120.000000');
  });

  it('warns when the file has no sound to keep and goes without', () => {
    const p = ok(plan(input(media({ tracks: [videoTrackOnly()] }), video)));
    expect(p.warnings).toContain('audio-absent');
    expect(render(p)).toContain('-an');
  });

  it('replaces the sound with another file\'s, bounded to the picture', () => {
    const own = { extract: { kind: 'video' as const, audio: 'replace' as const, replaceWith: { fileId: 'b', track: 0 } } };
    const replacement = { path: '/in/other', info: media() };
    expect(plan(input(clip(), own))).toEqual({ error: 'replace-missing' });
    const p = ok(plan({ ...input(clip(), own), replacement }));
    expect(render(p)).toContain('-i /in/song -i /in/other -map 0:v:0 -map 1:a:0');
    expect(render(p)).toContain('-t 120.000000');
  });

  it('measures a replaced sound on the replacement alone', () => {
    const own = { extract: { kind: 'video' as const, audio: 'replace' as const, replaceWith: { fileId: 'b', track: 0 } }, normalize: { enabled: true } };
    const p = ok(plan({ ...input(clip(), own), replacement: { path: '/in/other', info: media() } }));
    expect(p.measure?.args.join(' ')).toBe('-hide_banner -nostdin -y -i /in/other -map 0:a:0 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -t 120.000000 -f null -');
  });

  it('copies the streams as they are, in the container that fits', () => {
    const p = ok(plan(input(clip(), { extract: { kind: 'video', mode: 'copy' } }, { in: 5 })));
    expect(p.extension).toBe('mp4');
    expect(p.warnings).toContain('keyframe-cut');
    expect(render(p)).toContain('-c:v copy -c:a copy');
    expect(ok(plan(input(clip({}, { codec: 'ffv1' }), { extract: { kind: 'video', mode: 'copy' } }))).extension).toBe('mkv');
  });

  it('warns about HDR sources', () => {
    expect(ok(plan(input(clip({}, { transfer: 'smpte2084' }), video))).warnings).toContain('hdr-not-mapped');
  });
});

function videoTrackOnly() {
  return videoTrack();
}

describe('frameArgs', () => {
  const v = videoTrack();
  it('takes the oriented picture as it is', () => {
    expect(frameArgs({ video: v, inputPath: '/in/a', outputPath: '/out/f', time: 1.5, format: 'png' })).toEqual([
      '-hide_banner', '-nostdin', '-y', '-ss', '1.500000', '-i', '/in/a', '-map', '0:v:0', '-frames:v', '1', '-f', 'image2', '-update', '1', '/out/f',
    ]);
  });
  it('applies the picture settings without the rate', () => {
    const picture = { ...defaultSettings().picture, scale: { mode: 'stretch' as const, width: 640, height: 360 } };
    const a = frameArgs({ video: v, inputPath: '/in/a', outputPath: '/out/f', time: 0, format: 'jpeg', picture });
    expect(Array.isArray(a) && a.join(' ')).toContain('-vf scale=w=640:h=360,setsar=1 -q:v 3');
  });
});
