// Presets: the picker and «Procesar» at the foot of «Salida», `PopPresets` to manage them, and the
// quick actions on «Inicio», which add files and process them with a preset at once.

import { useSignal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { processable } from '../../app/output.ts';
import { useApp, type AppState } from '../../app/state.ts';
import { t } from '../../i18n/index.ts';
import type { Preset } from '../../model/formats.ts';
import { applyPreset } from '../../model/project.ts';
import { chooseFiles, dropped, takenDrops, takeIn } from '../adding.ts';
import { Dialog } from '../Dialog.tsx';
import { announce } from '../layout.ts';
import { save } from '../../app/output.ts';
import { processSelection, quickAction } from './process.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function PresetRow({ preset }: { preset: Preset }) {
  const { presets, store } = useApp();
  const [name, setName] = useState<string | null>(null);
  return (
    <li class="preset-row">
      <input
        class="input"
        aria-label={t('presets.name')}
        value={name ?? preset.name}
        onInput={(e) => setName(e.currentTarget.value)}
        onBlur={() => {
          if (name !== null) presets.rename(preset.id, name);
          setName(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <button
        type="button"
        class="button small-button"
        onClick={() => {
          store.run((p) => applyPreset(p, preset.settings));
          announce(t('presets.applied', { name: preset.name }));
        }}
      >
        {t('presets.apply')}
      </button>
      <button type="button" class="button small-button" onClick={() => presets.remove(preset.id)}>
        {t('presets.delete')}
      </button>
    </li>
  );
}

function PopPresets({ open, onClose }: { open: boolean; onClose(): void }) {
  const { presets, project } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = presets.importText(await f.text());
      if (r.ok) {
        setError('');
        announce(t('presets.imported', { n: r.added }));
      } else setError(t(r.error.code === 'too-new' ? 'presets.tooNew' : 'presets.unreadable'));
    });
    input.click();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('presets.title')}>
      <ul class="preset-list">
        {presets.list.value.map((p) => (
          <PresetRow key={p.id} preset={p} />
        ))}
      </ul>
      <form
        class="row wrap preset-save"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          presets.add(name, project.value.batch);
          announce(t('presets.saved', { name: name.trim() }));
          setName('');
        }}
      >
        <input class="input grow" aria-label={t('presets.newName')} placeholder={t('presets.newName')} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button type="submit" class="button" disabled={!name.trim()}>
          {t('presets.saveBatch')}
        </button>
      </form>
      {error && (
        <p class="step-warning" role="alert">
          {error}
        </p>
      )}
      <div class="row wrap dialog-actions">
        <button type="button" class="button" onClick={importFile}>
          {t('presets.import')}
        </button>
        <button
          type="button"
          class="button"
          disabled={presets.list.value.length === 0}
          onClick={() => save('compositio-presets.json', new Blob([presets.exportText()], { type: 'application/json' }))}
        >
          {t('presets.export')}
        </button>
      </div>
    </Dialog>
  );
}

/** The foot of «Salida»: which preset the batch is, managing them, and «Procesar N». */
export function OutputFoot() {
  const app = useApp();
  const { presets, project, store, files } = app;
  const managing = useSignal(false);
  const current = presets.list.value.find((p) => same(p.settings, project.value.batch));
  // Read so the count follows the selection and the files present.
  void files.selected.value;
  void files.sources.value;
  const n = processable(project.value, files).length;
  return (
    <div class="output-foot">
      <div class="row">
        <select
          class="input grow"
          aria-label={t('output.preset')}
          title={t('output.preset')}
          value={current?.id ?? ''}
          onChange={(e) => {
            const p = presets.list.value.find((x) => x.id === e.currentTarget.value);
            if (p) store.run((pr) => applyPreset(pr, p.settings));
          }}
        >
          <option value="" disabled>
            {t('presets.none')}
          </option>
          {presets.list.value.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" class="button" aria-haspopup="dialog" onClick={() => (managing.value = true)}>
          {t('presets.manage')}
        </button>
      </div>
      <button type="button" class="button primary wide" disabled={n === 0} onClick={() => processSelection(app)}>
        {t('output.processN', { n })}
      </button>
      <PopPresets open={managing.value} onClose={() => (managing.value = false)} />
    </div>
  );
}

function dropOn(app: AppState, preset: Preset) {
  return (e: DragEvent) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    // Taken here, not by the window: these files go straight to this preset.
    e.preventDefault();
    takenDrops.add(e);
    void dropped(e.dataTransfer).then(async (batch) => {
      const ids = await takeIn(app, batch);
      if (ids.length) quickAction(app, preset, ids);
    });
  };
}

/** On «Inicio», one button per preset: files chosen with it or dropped on it are added and processed. */
export function QuickActions() {
  const app = useApp();
  const list = app.presets.list.value;
  if (list.length === 0) return null;
  return (
    <div class="quick-actions" role="group" aria-labelledby="quick-title">
      <span id="quick-title" class="muted small">
        {t('quick.title')}
      </span>
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          class="button small-button quick"
          title={t('quick.hint', { name: p.name })}
          disabled={!app.engine}
          onClick={() => chooseFiles(app, (ids) => quickAction(app, p, ids))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={dropOn(app, p)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
