// «Salida» («Definitivo», «InspectorDetalle»): the steps in their fixed order, for the batch or
// for the active file. A file's own value carries a mark and a way back to the batch's. «Imagen»
// only appears when the output is a video.

import { useSignal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { useApp } from '../../app/state.ts';
import { t, type Key } from '../../i18n/index.ts';
import { audioTracks, clockTime, type MediaInfo } from '../../model/media.ts';
import { applyPattern } from '../../model/naming.ts';
import { plan, type Warning } from '../../model/operations.ts';
import { clearOwn } from '../../model/project.ts';
import { effectiveSettings, FORMATS, H264_PRESETS, HAP_VARIANTS, PRORES_PROFILES, SAMPLE_RATES, type Step } from '../../model/settings.ts';
import { Check, NumberField, Select, Setting, inspectorScope, useCtx, type Ctx } from './controls.tsx';
import { Picture } from './Picture.tsx';
import { inspectorSteps, STEP_LABEL } from '../steps.ts';
import { Tabs } from '../Tabs.tsx';

export { NumberField } from './controls.tsx';

const WARNING_STEP: Record<Warning, Step> = {
  'copy-ignores-processing': 'extract',
  'lossless-unavailable': 'trim',
  'fades-shortened': 'trim',
  'lossy-reencode': 'convert',
  'rate-adjusted': 'convert',
  'keyframe-cut': 'trim',
  'audio-absent': 'extract',
  'hdr-not-mapped': 'picture',
  'size-rounded': 'picture',
  'output-may-not-fit': 'convert',
  'slow-video': 'picture',
  'webcodecs-fallback': 'picture',
  'mix-ignores-speed': 'picture',
  'video-curve-linear': 'picture',
};

function Warnings({ step, warnings }: { step: Step; warnings: readonly Warning[] }) {
  const mine = warnings.filter((w) => WARNING_STEP[w] === step);
  if (!mine.length) return null;
  return (
    <ul class="step-warnings">
      {mine.map((w) => (
        <li key={w} class="step-warning">
          {t(`warning.${w}` as Key)}
        </li>
      ))}
    </ul>
  );
}

const kHz = (rate: number) => `${(rate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;

const channelsText = (n: number): string => (n === 1 ? t('tech.mono') : n === 2 ? t('tech.stereo') : t('tech.channels', { n }));

function Extract({ ctx, info }: { ctx: Ctx; info: MediaInfo | undefined }) {
  const { project, files } = useApp();
  const s = ctx.settings.extract;
  const video = s.kind === 'video';
  const tracks = info ? audioTracks(info) : [];
  const count = Math.max(tracks.length, s.track + 1, 1);
  const options = Array.from({ length: count }, (_, i) => {
    const tr = tracks[i];
    return [i, tr ? `${i + 1} · ${tr.codec.toUpperCase()} · ${channelsText(tr.channels)}` : String(i + 1)] as const;
  });

  // The files whose sound can replace this one's: the others of the project that have any.
  const candidates = project.value.files.filter((f) => f.id !== ctx.file?.id && f.id !== files.active.value && (files.infos.value.get(f.id) ? audioTracks(files.infos.value.get(f.id)!).length > 0 : false));
  const replacing = s.audio === 'replace';
  const canReplace = ctx.scope === 'file' && candidates.length > 0;
  const chosen = s.replaceWith ? files.infos.value.get(s.replaceWith.fileId) : undefined;
  const chosenTracks = chosen ? audioTracks(chosen) : [];

  // Why «Sustituir» is not among the options, as a tooltip: help does not sit as text beside the controls.
  const replaceHint = replacing ? undefined : ctx.scope === 'batch' ? t('output.replaceOnlyFile') : candidates.length === 0 ? t('output.replaceNone') : undefined;
  const audioOptions: (readonly [typeof s.audio, string])[] = [
    ['keep', t('output.audioKeep')],
    ['none', t('output.audioNone')],
    ['silence', t('output.audioSilence')],
    ...(canReplace || replacing ? ([['replace', t('output.audioReplace')]] as const) : []),
  ];

  return (
    <>
      <Setting ctx={ctx} step="extract" name="kind" label={t('output.kind')}>
        {(id) => (
          <Select
            id={id}
            value={s.kind}
            options={[
              ['audio', t('output.kindAudio')],
              ['video', t('output.kindVideo')],
            ]}
            onChange={(kind) => ctx.set('extract', { kind })}
          />
        )}
      </Setting>
      {(!video || s.audio === 'keep') && (
        <Setting ctx={ctx} step="extract" name="track" label={t('output.track')}>
          {(id) => <Select id={id} value={s.track} options={options} onChange={(track) => ctx.set('extract', { track })} />}
        </Setting>
      )}
      <Setting ctx={ctx} step="extract" name="mode" label={t('output.mode')}>
        {(id) => (
          <Select
            id={id}
            value={s.mode}
            options={[
              ['encode', t('output.encode')],
              ['copy', t('output.copy')],
            ]}
            onChange={(mode) => ctx.set('extract', { mode })}
          />
        )}
      </Setting>
      {video && (
        <>
          <Setting ctx={ctx} step="extract" name="audio" label={t('output.audioOfVideo')}>
            {(id) => (
              <Select
                id={id}
                value={s.audio}
                options={audioOptions}
                title={replaceHint}
                onChange={(audio) => {
                  const first = candidates[0];
                  ctx.set('extract', audio === 'replace' && !s.replaceWith && first ? { audio, replaceWith: { fileId: first.id, track: 0 } } : { audio });
                }}
              />
            )}
          </Setting>
          {replacing && (
            <>
              <Setting ctx={ctx} step="extract" name="replaceWith" label={t('output.replaceWith')}>
                {(id) => (
                  <Select<string>
                    id={id}
                    value={s.replaceWith?.fileId ?? ''}
                    options={[
                      ...(s.replaceWith && !candidates.some((f) => f.id === s.replaceWith!.fileId) ? ([[s.replaceWith.fileId, '—']] as const) : []),
                      ...candidates.map((f) => [f.id, `${f.name} · ${clockTime(files.infos.value.get(f.id)?.duration ?? f.duration ?? 0)}`] as const),
                    ]}
                    onChange={(fileId) => ctx.set('extract', { replaceWith: { fileId, track: 0 } })}
                  />
                )}
              </Setting>
              {chosenTracks.length > 1 && s.replaceWith && (
                <Setting ctx={ctx} step="extract" name="replaceWith" label={t('output.replaceTrack')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={s.replaceWith!.track}
                      options={chosenTracks.map((tr, i) => [i, `${i + 1} · ${tr.codec.toUpperCase()} · ${channelsText(tr.channels)}`] as const)}
                      onChange={(track) => ctx.set('extract', { replaceWith: { fileId: s.replaceWith!.fileId, track } })}
                    />
                  )}
                </Setting>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function Trim({ ctx }: { ctx: Ctx }) {
  const s = ctx.settings.trim;
  return (
    <>
      <Check ctx={ctx} step="trim" name="silence" label={t('output.silence')} checked={s.silence} onChange={(silence) => ctx.set('trim', { silence })} />
      <Check ctx={ctx} step="trim" name="lossless" label={t('output.lossless')} checked={s.lossless} onChange={(lossless) => ctx.set('trim', { lossless })} />
    </>
  );
}

function Normalize({ ctx }: { ctx: Ctx }) {
  const n = ctx.settings.normalize;
  return (
    <>
      <Check ctx={ctx} step="normalize" name="enabled" label={t('output.normalizeOn')} checked={n.enabled} onChange={(enabled) => ctx.set('normalize', { enabled })} />
      {n.enabled && (
        <>
          <Setting ctx={ctx} step="normalize" name="mode" label={t('output.normalizeMode')}>
            {(id) => (
              <Select
                id={id}
                value={n.mode}
                options={[
                  ['lufs', t('output.lufsMode')],
                  ['peak', t('output.peakMode')],
                ]}
                onChange={(mode) => ctx.set('normalize', { mode })}
              />
            )}
          </Setting>
          {n.mode === 'lufs' ? (
            <>
              <Setting ctx={ctx} step="normalize" name="lufs" label={t('output.lufs')}>
                {(id) => <NumberField id={id} value={n.lufs} min={-70} max={-5} step={0.5} unit="LUFS" onChange={(lufs) => ctx.set('normalize', { lufs })} />}
              </Setting>
              <Setting ctx={ctx} step="normalize" name="truePeak" label={t('output.truePeak')}>
                {(id) => <NumberField id={id} value={n.truePeak} min={-9} max={0} step={0.1} unit="dBTP" onChange={(truePeak) => ctx.set('normalize', { truePeak })} />}
              </Setting>
              <Setting ctx={ctx} step="normalize" name="lra" label={t('output.lra')}>
                {(id) => <NumberField id={id} value={n.lra} min={1} max={50} step={1} unit="LU" onChange={(lra) => ctx.set('normalize', { lra })} />}
              </Setting>
            </>
          ) : (
            <Setting ctx={ctx} step="normalize" name="peak" label={t('output.peak')}>
              {(id) => <NumberField id={id} value={n.peak} min={-30} max={0} step={0.1} unit="dBFS" onChange={(peak) => ctx.set('normalize', { peak })} />}
            </Setting>
          )}
        </>
      )}
    </>
  );
}

const FORMAT_LABEL: Record<(typeof FORMATS)[number], string> = { wav: 'WAV', flac: 'FLAC', mp3: 'MP3', aac: 'AAC (M4A)', opus: 'Opus', ogg: 'OGG Vorbis' };
const PRESET_LABEL: Record<(typeof H264_PRESETS)[number], Key> = { veryfast: 'output.presetVeryfast', fast: 'output.presetFast', medium: 'output.presetMedium', slow: 'output.presetSlow' };
export const HAP_LABEL: Record<(typeof HAP_VARIANTS)[number], Key> = { hap: 'output.hapPlain', hapq: 'output.hapQ' };
export const PROFILE_LABEL: Record<(typeof PRORES_PROFILES)[number], string> = { proxy: 'Proxy', lt: 'LT', standard: 'Standard', hq: 'HQ', '4444': '4444' };
const QUALITIES = [
  [18, 'output.qualityHigh'],
  [23, 'output.qualityMedium'],
  [28, 'output.qualityLow'],
] as const;

/** The sound's fields shared by both outputs: sample rate and channels. */
function RateAndChannels({ ctx }: { ctx: Ctx }) {
  const c = ctx.settings.convert;
  return (
    <>
      <Setting ctx={ctx} step="convert" name="sampleRate" label={t('output.sampleRate')}>
        {(id) => (
          <Select<'source' | (typeof SAMPLE_RATES)[number]>
            id={id}
            value={c.sampleRate}
            options={[['source', t('output.source')], ...SAMPLE_RATES.map((r) => [r, kHz(r)] as const)]}
            onChange={(sampleRate) => ctx.set('convert', { sampleRate })}
          />
        )}
      </Setting>
      <Setting ctx={ctx} step="convert" name="channels" label={t('output.channels')}>
        {(id) => (
          <Select<'source' | 1 | 2>
            id={id}
            value={c.channels}
            options={[
              ['source', t('output.source')],
              [1, t('tech.mono')],
              [2, t('tech.stereo')],
            ]}
            onChange={(channels) => ctx.set('convert', { channels })}
          />
        )}
      </Setting>
    </>
  );
}

/** A video file: the picture's codec first, then only the sound fields its container takes (AAC in MP4, PCM in MOV). */
function ConvertVideo({ ctx }: { ctx: Ctx }) {
  const c = ctx.settings.convert;
  const sound = ctx.settings.extract.audio !== 'none';
  return (
    <>
      <Setting ctx={ctx} step="convert" name="videoFormat" label={t('output.videoFormat')}>
        {(id) => (
          <Select
            id={id}
            value={c.videoFormat}
            options={[
              ['mp4', t('output.videoMp4')],
              ['prores', t('output.videoProres')],
              ['hap', t('output.videoHap')],
            ]}
            onChange={(videoFormat) => ctx.set('convert', { videoFormat })}
          />
        )}
      </Setting>
      {c.videoFormat === 'mp4' ? (
        <>
          <Setting ctx={ctx} step="convert" name="h264Crf" label={t('output.quality')}>
            {(id) => (
              <>
                <NumberField id={id} value={c.h264Crf} min={0} max={51} step={1} unit="CRF" onChange={(h264Crf) => ctx.set('convert', { h264Crf })} />
                {QUALITIES.map(([crf, key]) => (
                  <button key={crf} type="button" class="button small-button" aria-pressed={c.h264Crf === crf} onClick={() => ctx.set('convert', { h264Crf: crf })}>
                    {t(key)}
                  </button>
                ))}
              </>
            )}
          </Setting>
          <Setting ctx={ctx} step="convert" name="h264Preset" label={t('output.encoderSpeed')}>
            {(id) => <Select id={id} value={c.h264Preset} options={H264_PRESETS.map((p) => [p, t(PRESET_LABEL[p])] as const)} onChange={(h264Preset) => ctx.set('convert', { h264Preset })} />}
          </Setting>
        </>
      ) : c.videoFormat === 'hap' ? (
        <Setting ctx={ctx} step="convert" name="hapVariant" label={t('output.hapVariant')}>
          {(id) => <Select id={id} value={c.hapVariant} title={t('output.hapVariantHint')} options={HAP_VARIANTS.map((h) => [h, t(HAP_LABEL[h])] as const)} onChange={(hapVariant) => ctx.set('convert', { hapVariant })} />}
        </Setting>
      ) : (
        <Setting ctx={ctx} step="convert" name="proresProfile" label={t('output.proresProfile')}>
          {(id) => <Select id={id} value={c.proresProfile} options={PRORES_PROFILES.map((p) => [p, PROFILE_LABEL[p]] as const)} onChange={(proresProfile) => ctx.set('convert', { proresProfile })} />}
        </Setting>
      )}
      {sound && (
        <>
          <RateAndChannels ctx={ctx} />
          {c.videoFormat === 'mp4' ? (
            <Setting ctx={ctx} step="convert" name="aacBitrate" label={t('output.audioBitrate')}>
              {(id) => <Select<128 | 192 | 256 | 320> id={id} value={c.aacBitrate} options={([128, 192, 256, 320] as const).map((b) => [b, `${b} kbps`] as const)} onChange={(aacBitrate) => ctx.set('convert', { aacBitrate })} />}
            </Setting>
          ) : (
            <>
              <Setting ctx={ctx} step="convert" name="bitDepth" label={t('output.bitDepth')}>
                {(id) => (
                  <Select<16 | 24 | 32>
                    id={id}
                    value={c.bitDepth}
                    options={[
                      [16, '16 bit'],
                      [24, '24 bit'],
                      [32, t('output.float32')],
                    ]}
                    onChange={(bitDepth) => ctx.set('convert', { bitDepth })}
                  />
                )}
              </Setting>
              {c.bitDepth === 16 && <Check ctx={ctx} step="convert" name="dither" label={t('output.dither')} checked={c.dither} onChange={(dither) => ctx.set('convert', { dither })} />}
            </>
          )}
        </>
      )}
      <Check ctx={ctx} step="convert" name="keepMetadata" label={t('output.keepMetadata')} checked={c.keepMetadata} onChange={(keepMetadata) => ctx.set('convert', { keepMetadata })} />
    </>
  );
}

function Convert({ ctx }: { ctx: Ctx }) {
  const c = ctx.settings.convert;
  if (ctx.settings.extract.kind === 'video') return <ConvertVideo ctx={ctx} />;
  const deep = c.format === 'wav' || c.format === 'flac';
  return (
    <>
      <Setting ctx={ctx} step="convert" name="format" label={t('output.format')}>
        {(id) => <Select id={id} value={c.format} options={FORMATS.map((f) => [f, FORMAT_LABEL[f]] as const)} onChange={(format) => ctx.set('convert', { format })} />}
      </Setting>
      <Setting ctx={ctx} step="convert" name="sampleRate" label={t('output.sampleRate')}>
        {(id) => (
          <Select<'source' | (typeof SAMPLE_RATES)[number]>
            id={id}
            value={c.sampleRate}
            options={[['source', t('output.source')], ...SAMPLE_RATES.map((r) => [r, kHz(r)] as const)]}
            onChange={(sampleRate) => ctx.set('convert', { sampleRate })}
          />
        )}
      </Setting>
      {deep && (
        <Setting ctx={ctx} step="convert" name="bitDepth" label={t('output.bitDepth')}>
          {(id) => (
            <Select<16 | 24 | 32>
              id={id}
              value={c.bitDepth}
              options={[
                [16, '16 bit'],
                [24, '24 bit'],
                [32, c.format === 'wav' ? t('output.float32') : '24 bit'],
              ].filter(([v]) => c.format === 'wav' || v !== 32) as [16 | 24 | 32, string][]}
              onChange={(bitDepth) => ctx.set('convert', { bitDepth })}
            />
          )}
        </Setting>
      )}
      {deep && c.bitDepth === 16 && <Check ctx={ctx} step="convert" name="dither" label={t('output.dither')} checked={c.dither} onChange={(dither) => ctx.set('convert', { dither })} />}
      <Setting ctx={ctx} step="convert" name="channels" label={t('output.channels')}>
        {(id) => (
          <Select<'source' | 1 | 2>
            id={id}
            value={c.channels}
            options={[
              ['source', t('output.source')],
              [1, t('tech.mono')],
              [2, t('tech.stereo')],
            ]}
            onChange={(channels) => ctx.set('convert', { channels })}
          />
        )}
      </Setting>
      {c.format === 'mp3' && (
        <>
          <Setting ctx={ctx} step="convert" name="mp3" label={t('output.mp3Mode')}>
            {(id) => (
              <Select
                id={id}
                value={c.mp3.mode}
                options={[
                  ['cbr', t('output.cbr')],
                  ['vbr', t('output.vbr')],
                ]}
                onChange={(mode) => ctx.set('convert', { mp3: { ...c.mp3, mode } })}
              />
            )}
          </Setting>
          {c.mp3.mode === 'cbr' ? (
            <Setting ctx={ctx} step="convert" name="mp3" label={t('output.bitrate')}>
              {(id) => <Select<128 | 160 | 192 | 256 | 320> id={id} value={c.mp3.bitrate} options={([128, 160, 192, 256, 320] as const).map((b) => [b, `${b} kbps`] as const)} onChange={(bitrate) => ctx.set('convert', { mp3: { ...c.mp3, bitrate } })} />}
            </Setting>
          ) : (
            <Setting ctx={ctx} step="convert" name="mp3" label={t('output.vbrQuality')}>
              {(id) => <Select id={id} value={c.mp3.quality} options={Array.from({ length: 10 }, (_, q) => [q, `V${q}`] as const)} onChange={(quality) => ctx.set('convert', { mp3: { ...c.mp3, quality } })} />}
            </Setting>
          )}
        </>
      )}
      {c.format === 'aac' && (
        <Setting ctx={ctx} step="convert" name="aacBitrate" label={t('output.bitrate')}>
          {(id) => <Select<128 | 192 | 256 | 320> id={id} value={c.aacBitrate} options={([128, 192, 256, 320] as const).map((b) => [b, `${b} kbps`] as const)} onChange={(aacBitrate) => ctx.set('convert', { aacBitrate })} />}
        </Setting>
      )}
      {c.format === 'opus' && (
        <Setting ctx={ctx} step="convert" name="opusBitrate" label={t('output.bitrate')}>
          {(id) => <Select<96 | 128 | 160 | 192 | 256> id={id} value={c.opusBitrate} options={([96, 128, 160, 192, 256] as const).map((b) => [b, `${b} kbps`] as const)} onChange={(opusBitrate) => ctx.set('convert', { opusBitrate })} />}
        </Setting>
      )}
      {c.format === 'ogg' && (
        <Setting ctx={ctx} step="convert" name="oggQuality" label={t('output.oggQuality')}>
          {(id) => <Select id={id} value={c.oggQuality} options={Array.from({ length: 11 }, (_, q) => [q, `Q${q}`] as const)} onChange={(oggQuality) => ctx.set('convert', { oggQuality })} />}
        </Setting>
      )}
      <Check ctx={ctx} step="convert" name="keepMetadata" label={t('output.keepMetadata')} checked={c.keepMetadata} onChange={(keepMetadata) => ctx.set('convert', { keepMetadata })} />
    </>
  );
}

const TOKENS = ['name', 'n', 'title', 'artist'] as const;

function Output({ ctx, example }: { ctx: Ctx; example: { name: string; info?: MediaInfo; n: number; total: number; extension: string } | null }) {
  const o = ctx.settings.output;
  const [draft, setDraft] = useState<string | null>(null);
  const pattern = draft ?? o.pattern;
  const commit = (value: string) => {
    setDraft(null);
    if (value.trim()) ctx.set('output', { pattern: value });
  };
  return (
    <>
      <Setting ctx={ctx} step="output" name="pattern" label={t('output.pattern')}>
        {(id) => (
          <input
            id={id}
            class="input mono pattern"
            value={pattern}
            spellcheck={false}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
          />
        )}
      </Setting>
      <div class="tokens" role="group" aria-label={t('output.tokens')}>
        {TOKENS.map((tok) => (
          <button key={tok} type="button" class="button small-button mono" title={t(`token.${tok}` as Key)} onClick={() => commit(`${pattern}{${tok}}`)}>
            {`{${tok}}`}
          </button>
        ))}
      </div>
      {example && (
        <p class="muted small mono example">
          {applyPattern(pattern || '{name}', { name: example.name, n: example.n, total: example.total, title: example.info?.tags.title, artist: example.info?.tags.artist }, example.extension)}
        </p>
      )}
    </>
  );
}

function StepBody({ step, ctx, info, warnings, example }: { step: Step; ctx: Ctx; info: MediaInfo | undefined; warnings: readonly Warning[]; example: Parameters<typeof Output>[0]['example'] }) {
  return (
    <div class="step-body">
      {step === 'extract' && <Extract ctx={ctx} info={info} />}
      {step === 'trim' && <Trim ctx={ctx} />}
      {step === 'picture' && <Picture ctx={ctx} info={info} />}
      {step === 'normalize' && <Normalize ctx={ctx} />}
      {step === 'convert' && <Convert ctx={ctx} />}
      {step === 'output' && <Output ctx={ctx} example={example} />}
      <Warnings step={step} warnings={warnings} />
    </div>
  );
}

/** Desktop: the steps in order, all visible. Tablet and phone: numbered tabs. */
export function Inspector({ tabs }: { tabs: boolean }) {
  const { project, files, store } = useApp();
  const scope = inspectorScope;
  const chosen = useSignal<Step>('extract');
  const file = project.value.files.find((f) => f.id === files.active.value);
  const info = file && files.infos.value.get(file.id);
  const ctx = useCtx(scope.value, file);
  const steps = inspectorSteps(ctx.settings);
  // The picture's tab goes away when the output turns into sound.
  const step = steps.includes(chosen.value) ? chosen.value : 'extract';

  // What the plan says about the active file with these settings.
  const effective = file ? effectiveSettings(project.value.batch, file.edits.own) : null;
  const rep = effective?.extract.replaceWith ? { path: 'in2', info: files.infos.value.get(effective.extract.replaceWith.fileId) } : null;
  const p = file && info && effective ? plan({ info, edits: file.edits, settings: effective, silences: files.silences.value.get(file.id), ...(rep?.info ? { replacement: { path: rep.path, info: rep.info } } : {}), inputPath: 'in', outputPath: 'out' }) : null;
  const warnings = p && !('error' in p) ? p.warnings : [];
  const index = file ? project.value.files.indexOf(file) : -1;
  const example = file ? { name: file.name, info, n: index + 1, total: project.value.files.length, extension: p && !('error' in p) ? p.extension : ctx.settings.convert.format } : null;
  const label = (s: Step) => `${steps.indexOf(s) + 1} ${t(STEP_LABEL[s])}`;
  const owned = file ? Object.keys(file.edits.own).length > 0 : false;

  return (
    <div class="inspector">
      {file && (
        <div class="scope">
          <div class="segmented" role="group" aria-label={t('output.scope')}>
            {(['batch', 'file'] as const).map((s) => (
              <button key={s} type="button" class="segment" aria-pressed={ctx.scope === s} onClick={() => (scope.value = s)}>
                {t(s === 'batch' ? 'output.batch' : 'output.thisFile')}
              </button>
            ))}
          </div>
          {ctx.scope === 'file' && owned && (
            <button type="button" class="button small-button" onClick={() => store.run((pr) => clearOwn(pr, file.id))}>
              {t('output.clearOwn')}
            </button>
          )}
        </div>
      )}
      {ctx.scope === 'file' && file && <p class="muted small scope-file">{file.name}</p>}
      {tabs ? (
        <Tabs label={t('output.steps')} idPrefix="output" tabs={steps.map((s) => ({ id: s, label: label(s) }))} selected={step} onSelect={(s) => (chosen.value = s)}>
          <StepBody step={step} ctx={ctx} info={info} warnings={warnings} example={example} />
        </Tabs>
      ) : (
        <ol class="steps">
          {steps.map((s) => (
            <li key={s} class="step">
              <h3 class="step-title">{label(s)}</h3>
              <StepBody step={s} ctx={ctx} info={info} warnings={warnings} example={example} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
