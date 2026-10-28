// «Salida» («Definitivo», «InspectorDetalle»): the five steps in their fixed order, for the batch or
// for the active file. A file's own value carries a mark and a way back to the batch's.

import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../../app/state.ts';
import { t, type Key } from '../../i18n/index.ts';
import type { FileRef } from '../../model/formats.ts';
import { audioTracks, type MediaInfo } from '../../model/media.ts';
import { applyPattern } from '../../model/naming.ts';
import { plan, type Warning } from '../../model/operations.ts';
import { clearOwn, setBatch, setOwn, type Project } from '../../model/project.ts';
import { effectiveSettings, FORMATS, SAMPLE_RATES, STEPS, type OutputSettings, type Overrides, type Step } from '../../model/settings.ts';
import { CloseIcon } from '../icons.tsx';
import { STEP_LABEL } from '../steps.ts';
import { Tabs } from '../Tabs.tsx';

type Scope = 'batch' | 'file';

interface Ctx {
  scope: Scope;
  settings: OutputSettings;
  own: Overrides;
  set<S extends Step>(step: S, values: Partial<OutputSettings[S]>, group?: string): void;
  reset(step: Step, key: string): void;
}

function useCtx(scope: Scope, file: FileRef | undefined): Ctx {
  const { project, store } = useApp();
  const batch = project.value.batch;
  const asFile = scope === 'file' && file !== undefined;
  const own = asFile ? file.edits.own : {};
  return {
    scope: asFile ? 'file' : 'batch',
    settings: asFile ? effectiveSettings(batch, own) : batch,
    own,
    set(step, values, group) {
      store.run((p) => (asFile ? setOwn(p, file.id, step, values as NonNullable<Overrides[typeof step]>) : setBatch(p, step, values)), group);
    },
    reset(step, key) {
      if (!asFile) return;
      // The batch's own value makes the file's equal to it, and equal values are dropped.
      store.run((p: Project) => setOwn(p, file.id, step, { [key]: (p.batch[step] as Record<string, unknown>)[key] } as never));
    },
  };
}

let fieldIds = 0;

/** A labelled control; with the file's own value, the mark and the way back to the batch. */
function Setting({ ctx, step, name, label, children }: { ctx: Ctx; step: Step; name: string; label: string; children: (id: string) => ComponentChildren }) {
  const [id] = useState(() => `out-${++fieldIds}`);
  const own = ctx.scope === 'file' && (ctx.own[step] as Record<string, unknown> | undefined)?.[name] !== undefined;
  return (
    <div class={`setting${own ? ' own' : ''}`}>
      <label for={id}>
        {own && <span class="own-mark" role="img" aria-label={t('files.own')} title={t('files.own')} />}
        {label}
      </label>
      <div class="setting-control">{children(id)}</div>
      {own && (
        <button type="button" class="icon-button small setting-reset" aria-label={t('output.toBatch', { name: label })} title={t('output.toBatch', { name: label })} onClick={() => ctx.reset(step, name)}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

function Select<T extends string | number>({ id, value, options, onChange }: { id: string; value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }) {
  return (
    <select id={id} class="input" value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.currentTarget.value)![0])}>
      {options.map(([v, label]) => (
        <option key={String(v)} value={String(v)}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Check({ ctx, step, name, label, checked, onChange }: { ctx: Ctx; step: Step; name: string; label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <Setting ctx={ctx} step={step} name={name} label={label}>
      {(id) => <input id={id} type="checkbox" class="check" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />}
    </Setting>
  );
}

/** A number applied when it is left or Enter is pressed, kept inside the schema's range. */
export function NumberField({ id, value, min, max, step, unit, label, onChange }: { id: string; value: number; min: number; max: number; step: number; unit?: string; label?: string; onChange(n: number): void }) {
  return (
    <span class="row number-field">
      <input
        id={id}
        aria-label={label}
        title={label}
        class="input mono"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (e.currentTarget.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          else e.currentTarget.value = String(value);
        }}
      />
      {unit && <span class="muted small">{unit}</span>}
    </span>
  );
}

const WARNING_STEP: Record<Warning, Step> = {
  'copy-ignores-processing': 'extract',
  'lossless-unavailable': 'trim',
  'fades-shortened': 'trim',
  'lossy-reencode': 'convert',
  'rate-adjusted': 'convert',
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

function Extract({ ctx, info }: { ctx: Ctx; info: MediaInfo | undefined }) {
  const s = ctx.settings.extract;
  const tracks = info ? audioTracks(info) : [];
  const count = Math.max(tracks.length, s.track + 1, 1);
  const options = Array.from({ length: count }, (_, i) => {
    const tr = tracks[i];
    return [i, tr ? `${i + 1} · ${tr.codec.toUpperCase()} · ${tr.channels === 1 ? t('tech.mono') : tr.channels === 2 ? t('tech.stereo') : t('tech.channels', { n: tr.channels })}` : String(i + 1)] as const;
  });
  return (
    <>
      <Setting ctx={ctx} step="extract" name="track" label={t('output.track')}>
        {(id) => <Select id={id} value={s.track} options={options} onChange={(track) => ctx.set('extract', { track })} />}
      </Setting>
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

function Convert({ ctx }: { ctx: Ctx }) {
  const c = ctx.settings.convert;
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
      {step === 'normalize' && <Normalize ctx={ctx} />}
      {step === 'convert' && <Convert ctx={ctx} />}
      {step === 'output' && <Output ctx={ctx} example={example} />}
      <Warnings step={step} warnings={warnings} />
    </div>
  );
}

/** Desktop: the five steps in order, all visible. Tablet and phone: numbered tabs. */
export function Inspector({ tabs }: { tabs: boolean }) {
  const { project, files, store } = useApp();
  const scope = useSignal<Scope>('batch');
  const step = useSignal<Step>('extract');
  const file = project.value.files.find((f) => f.id === files.active.value);
  const info = file && files.infos.value.get(file.id);
  const ctx = useCtx(scope.value, file);

  // What the plan says about the active file with these settings.
  const effective = file ? effectiveSettings(project.value.batch, file.edits.own) : null;
  const p = file && info && effective ? plan({ info, edits: file.edits, settings: effective, silences: files.silences.value.get(file.id), inputPath: 'in', outputPath: 'out' }) : null;
  const warnings = p && !('error' in p) ? p.warnings : [];
  const index = file ? project.value.files.indexOf(file) : -1;
  const example = file ? { name: file.name, info, n: index + 1, total: project.value.files.length, extension: p && !('error' in p) ? p.extension : ctx.settings.convert.format } : null;
  const label = (s: Step) => `${STEPS.indexOf(s) + 1} ${t(STEP_LABEL[s])}`;
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
        <Tabs label={t('output.steps')} idPrefix="output" tabs={STEPS.map((s) => ({ id: s, label: label(s) }))} selected={step.value} onSelect={(s) => (step.value = s)}>
          <StepBody step={step.value} ctx={ctx} info={info} warnings={warnings} example={example} />
        </Tabs>
      ) : (
        <ol class="steps">
          {STEPS.map((s) => (
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
