// Montages: `PopMontajes` (the library), saving with a name, and `PopReabrir` (the files of an
// opened montage that are still missing). One instance in the app; any button opens it through
// `montageDialog`.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { dropMissing, openMontage } from '../app/montages.ts';
import { stripLayout } from '../app/mix.ts';
import { save } from '../app/output.ts';
import { useApp } from '../app/state.ts';
import { lang, t } from '../i18n/index.ts';
import type { Montage } from '../model/formats.ts';
import { stem } from '../model/naming.ts';
import { emptyProject, markSaved } from '../model/project.ts';
import { requestPersistence, type Usage } from '../model/storage.ts';
import { chooseFiles } from './adding.ts';
import { Dialog } from './Dialog.tsx';
import { fileSize, shortTime } from './format.ts';
import { announce } from './layout.ts';

export const montageDialog = signal<'library' | 'save' | 'reopen' | null>(null);

const close = () => (montageDialog.value = null);

const summary = (m: Montage): string => t('mix.summary', { n: m.clips.length, duration: shortTime(stripLayout(m).duration) });

const day = (ms: number): string => new Intl.DateTimeFormat(lang.value, { day: '2-digit', month: '2-digit' }).format(ms);

function Library() {
  const app = useApp();
  const { montages, store, files } = app;
  const list = montages.list.value;
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    void requestPersistence().then(setUsage, () => {});
  }, [list.length]);
  const entry = list.find((e) => e.id === chosen);

  const open = () => {
    const m = entry?.montage;
    if (!m) return;
    const missing = openMontage(store, files, m);
    announce(t('montage.opened', { name: m.name || t('header.untitled') }));
    montageDialog.value = missing > 0 ? 'reopen' : null;
  };
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = montages.importText(await f.text());
      if (!r.ok) return setError(t(r.error.code === 'too-new' ? 'montage.tooNew' : 'montage.importError'));
      setError('');
      setChosen(r.id);
      announce(t('montage.imported', { name: montages.list.value.find((e) => e.id === r.id)?.montage?.name || t('header.untitled') }));
    });
    input.click();
  };
  const exportIt = () => {
    const text = entry && montages.exportText(entry.id);
    if (text) save(`${stem(entry.montage?.name || 'compositio')}.compositio.json`, new Blob([text], { type: 'application/json' }));
  };
  const remove = () => {
    if (!entry) return;
    montages.remove(entry.id);
    announce(t('montage.deleted', { name: entry.montage?.name || t('header.untitled') }));
    setChosen(null);
  };

  return (
    <Dialog open onClose={close} title={t('header.montages')}>
      {list.length === 0 ? (
        <p class="empty">{t('montage.empty')}</p>
      ) : (
        <ul class="montage-list" aria-label={t('header.montages')}>
          {list.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                class="montage-item"
                aria-pressed={e.id === chosen}
                disabled={!e.montage}
                onClick={() => setChosen(e.id)}
              >
                <span class="montage-text">
                  <span class="strong">{e.montage ? e.montage.name || t('header.untitled') : e.id.slice(0, 8)}</span>
                  <span class="muted small">{e.montage ? summary(e.montage) : t(e.error?.code === 'too-new' ? 'montage.tooNew' : 'montage.unreadable')}</span>
                </span>
                <span class="mono muted small">{day(e.savedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p class="step-warning" role="alert">
          {error}
        </p>
      )}
      {usage?.usage != null && usage.quota != null && <p class="muted small">{t('montage.usage', { used: fileSize(usage.usage), quota: fileSize(usage.quota) })}</p>}
      <div class="row wrap dialog-actions">
        <button type="button" class="button" onClick={importFile}>
          {t('montage.import')}
        </button>
        <button type="button" class="button" disabled={!entry?.montage} onClick={exportIt}>
          {t('montage.export')}
        </button>
        <button type="button" class="button" disabled={!entry} onClick={remove}>
          {t('montage.delete')}
        </button>
        <span class="grow" />
        <button type="button" class="button" onClick={() => (montageDialog.value = 'save')}>
          {t('montage.save')}
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            store.run(() => emptyProject());
            close();
          }}
        >
          {t('montage.new')}
        </button>
        <button type="button" class="button primary" disabled={!entry?.montage} onClick={open}>
          {t('montage.openIt')}
        </button>
      </div>
    </Dialog>
  );
}

function SaveMontage() {
  const { project, montages, store } = useApp();
  const p = project.value;
  const [name, setName] = useState(p.name);
  const saved = p.id !== null && montages.list.value.some((e) => e.id === p.id && e.montage);
  const go = (asNew: boolean) => {
    const n = name.trim();
    if (!n) return;
    const id = montages.save(store.get(), n, asNew);
    store.run((q) => markSaved(q, id, n));
    announce(t('montage.saved', { name: n }));
    close();
  };
  return (
    <Dialog open onClose={close} title={t('montage.save')}>
      <form
        class="montage-save"
        onSubmit={(e) => {
          e.preventDefault();
          go(false);
        }}
      >
        <label for="montage-name">{t('montage.name')}</label>
        <input id="montage-name" class="input" value={name} maxLength={200} onInput={(e) => setName(e.currentTarget.value)} />
        <div class="row wrap dialog-actions">
          {saved && (
            <button type="button" class="button" disabled={!name.trim()} onClick={() => go(true)}>
              {t('montage.saveNew')}
            </button>
          )}
          <button type="submit" class="button primary" disabled={!name.trim()}>
            {t('montage.saveOver')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Reopen() {
  const app = useApp();
  const { project, files, store } = app;
  const p = project.value;
  const here = (id: string) => files.sources.value.has(id);
  const found = p.files.filter((f) => here(f.id)).length;
  const total = p.files.length;
  return (
    <Dialog open onClose={close} title={p.name || t('header.untitled')}>
      <div class="meter">
        <span class="muted small">{t('reopen.count', { n: found, total })}</span>
        <progress max={Math.max(1, total)} value={found} aria-label={t('reopen.count', { n: found, total })} />
      </div>
      <ul class="reopen-list">
        {p.files.map((f) => (
          <li key={f.id} class={`reopen-item${here(f.id) ? '' : ' missing'}`}>
            <span class="reopen-state" role="img" aria-label={here(f.id) ? t('reopen.found') : t('reopen.missing')} />
            <span class="grow file-title">{f.name}</span>
            <span class="mono muted small">{f.duration === null ? '' : shortTime(f.duration)}</span>
          </li>
        ))}
      </ul>
      <div class="row wrap dialog-actions">
        <button type="button" class="button" onClick={() => chooseFiles(app)}>
          {t('files.add')}
        </button>
        <span class="grow" />
        <button
          type="button"
          class="button"
          disabled={found === total}
          onClick={() => {
            dropMissing(store, files);
            close();
          }}
        >
          {t('reopen.without')}
        </button>
        <button type="button" class="button primary" disabled={found < total} onClick={close}>
          {t('reopen.open')}
        </button>
      </div>
    </Dialog>
  );
}

export function MontageDialogs() {
  const which = montageDialog.value;
  if (which === 'library') return <Library />;
  if (which === 'save') return <SaveMontage />;
  if (which === 'reopen') return <Reopen />;
  return null;
}
