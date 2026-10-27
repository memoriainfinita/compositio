// The files column («Definitivo», «MovilArchivos»): batch checkboxes, own-settings mark, duration,
// the active file, removing, and the way to add more.

import { useEffect, useRef } from 'preact/hooks';
import { selectable, selectAll, toggleSelected } from '../app/files.ts';
import { useApp } from '../app/state.ts';
import { formatNumber, t } from '../i18n/index.ts';
import type { FileRef } from '../model/formats.ts';
import { removeFiles } from '../model/project.ts';
import { STEPS } from '../model/settings.ts';
import { chooseFiles } from './adding.ts';
import { shortTime, typeBadge } from './format.ts';
import { layout, announce } from './layout.ts';
import { Analyzing } from './Notices.tsx';
import { STEP_LABEL } from './steps.ts';

const ownSteps = (f: FileRef): string =>
  STEPS.filter((s) => f.edits.own[s] !== undefined)
    .map((s) => t(STEP_LABEL[s]))
    .join(', ');

function FileRow({ file, onActivate }: { file: FileRef; onActivate?: () => void }) {
  const { files } = useApp();
  const here = files.sources.value.has(file.id);
  const active = files.active.value === file.id;
  const own = ownSteps(file);
  const name = t('files.include', { name: file.name });
  // The saved duration only stands in until the file is here and probed.
  const duration = files.infos.value.get(file.id)?.duration ?? file.duration;
  return (
    <li class={`file-item${active ? ' active' : ''}${here ? '' : ' missing'}`}>
      <input
        type="checkbox"
        class="check"
        aria-label={name}
        title={name}
        checked={files.selected.value.has(file.id)}
        disabled={!here}
        onChange={(e) => toggleSelected(files, file.id, e.currentTarget.checked)}
      />
      <span class="type-badge mono" aria-hidden="true">
        {typeBadge(file.name)}
      </span>
      <button
        type="button"
        class="file-name"
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          files.active.value = file.id;
          onActivate?.();
        }}
      >
        <span class="file-title">{file.name}</span>
        {!here && <span class="file-missing">{t('files.missing')}</span>}
      </button>
      {own && <span class="own-mark" role="img" aria-label={t('files.own')} title={`${t('files.own')}: ${own}`} />}
      <span class="file-duration mono">{duration === null ? '' : shortTime(duration)}</span>
    </li>
  );
}

/** `onActivate`: on phones, choosing a file opens the editor. */
export function FileList({ onActivate }: { onActivate?: () => void }) {
  const app = useApp();
  return (
    <>
      <Analyzing />
      <ul class="file-list" aria-label={t('files.title')}>
        {app.project.value.files.map((f) => (
          <FileRow key={f.id} file={f} onActivate={onActivate} />
        ))}
      </ul>
      <button type="button" class="drop-hint" onClick={() => chooseFiles(app)}>
        {layout.value === 'mobile' ? t('files.add') : t('files.dropHere')}
      </button>
    </>
  );
}

function SelectAll() {
  const { store, files, project } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  // Read so the box follows the list.
  void project.value;
  const ids = selectable(store, files);
  const chosen = ids.filter((id) => files.selected.value.has(id)).length;
  const some = chosen > 0 && chosen < ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      class="check"
      aria-label={t('files.all')}
      title={t('files.all')}
      checked={ids.length > 0 && chosen === ids.length}
      disabled={ids.length === 0}
      onChange={(e) => selectAll(store, files, e.currentTarget.checked)}
    />
  );
}

export function FilesHead() {
  const { store, files, project } = useApp();
  const selected = files.selected.value;
  const remove = () => {
    const ids = [...selected];
    store.run((p) => removeFiles(p, ids));
    announce(t('files.removed', { n: ids.length }));
  };
  return (
    <div class="files-head">
      <SelectAll />
      <span class="muted small">{t('files.selectedOf', { n: formatNumber(selected.size), total: formatNumber(project.value.files.length) })}</span>
      <span class="grow" />
      <button type="button" class="button small-button" disabled={selected.size === 0} onClick={remove}>
        {t('files.remove')}
      </button>
    </div>
  );
}
