// The pieces the steps of «Salida» are made of: the context (batch or one file), a labelled
// setting with its mark and way back to the batch, and the plain controls.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import type { FileRef } from '../../model/formats.ts';
import { setBatch, setOwn, type Project } from '../../model/project.ts';
import { effectiveSettings, type OutputSettings, type Overrides, type Step } from '../../model/settings.ts';
import { CloseIcon } from '../icons.tsx';

export type Scope = 'batch' | 'file';

/** Whether the inspector edits the batch or the active file; the editor's picture follows it. */
export const inspectorScope = signal<Scope>('batch');

export interface Ctx {
  scope: Scope;
  settings: OutputSettings;
  own: Overrides;
  /** The file the settings are for, when they are its own. */
  file: FileRef | undefined;
  set<S extends Step>(step: S, values: Partial<OutputSettings[S]>, group?: string): void;
  reset(step: Step, key: string): void;
}

export function useCtx(scope: Scope, file: FileRef | undefined): Ctx {
  const { project, store } = useApp();
  const batch = project.value.batch;
  const asFile = scope === 'file' && file !== undefined;
  const own = asFile ? file.edits.own : {};
  return {
    scope: asFile ? 'file' : 'batch',
    settings: asFile ? effectiveSettings(batch, own) : batch,
    own,
    file: asFile ? file : undefined,
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
export const newFieldId = (): string => `out-${++fieldIds}`;

/** A labelled control; with the file's own value, the mark and the way back to the batch. */
export function Setting({ ctx, step, name, label, children }: { ctx: Ctx; step: Step; name: string; label: string; children: (id: string) => ComponentChildren }) {
  const [id] = useState(newFieldId);
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

export function Select<T extends string | number>({ id, value, options, title, onChange }: { id: string; value: T; options: readonly (readonly [T, string])[]; title?: string; onChange(v: T): void }) {
  return (
    <select id={id} class="input" title={title} value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.currentTarget.value)![0])}>
      {options.map(([v, label]) => (
        <option key={String(v)} value={String(v)}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Check({ ctx, step, name, label, checked, onChange }: { ctx: Ctx; step: Step; name: string; label: string; checked: boolean; onChange(on: boolean): void }) {
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
