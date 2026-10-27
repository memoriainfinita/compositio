// The single main view («Mesa con inspector»): files, editor and mix, output settings, queue.
// The content of each region arrives in steps 6 to 9; this places them for each layout.

import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useApp } from '../app/state.ts';
import { t, type Key } from '../i18n/index.ts';
import { STEPS, type Step } from '../model/settings.ts';
import { Dialog } from './Dialog.tsx';
import { Header } from './Header.tsx';
import { ListIcon, MixIcon, SlidersIcon, WaveIcon } from './icons.tsx';
import { layout } from './layout.ts';
import { Tabs } from './Tabs.tsx';

const STEP_LABEL: Record<Step, Key> = {
  extract: 'output.extract',
  trim: 'output.trim',
  normalize: 'output.normalize',
  convert: 'output.convert',
  output: 'output.output',
};

function FileList() {
  const { project } = useApp();
  return (
    <ul class="file-list">
      {project.value.files.map((f) => (
        <li key={f.id} class="file-item">
          {f.name}
        </li>
      ))}
    </ul>
  );
}

function FilesPanel() {
  const { project } = useApp();
  return (
    <section class="panel files" aria-labelledby="files-title">
      <div class="panel-head">
        <h2 id="files-title" class="panel-title">
          {t('files.title')}
        </h2>
        <span class="muted small">{t('files.count', { n: project.value.files.length })}</span>
      </div>
      <FileList />
    </section>
  );
}

const EditorPanel = () => (
  <section class="card editor" aria-labelledby="editor-title">
    <h2 id="editor-title" class="panel-title">
      {t('editor.title')}
    </h2>
    <p class="empty">{t('editor.empty')}</p>
  </section>
);

const MixPanel = () => (
  <section class="card mix" aria-labelledby="mix-title">
    <h2 id="mix-title" class="panel-title">
      {t('mix.title')}
    </h2>
    <p class="empty">{t('mix.empty')}</p>
  </section>
);

/** Desktop: the five steps in order, all visible. Tablet and phone: numbered tabs. */
function OutputSteps({ tabs }: { tabs: boolean }) {
  const step = useSignal<Step>('extract');
  const label = (s: Step) => `${STEPS.indexOf(s) + 1} ${t(STEP_LABEL[s])}`;
  if (!tabs) {
    return (
      <ol class="steps">
        {STEPS.map((s) => (
          <li key={s} class="step">
            <h3 class="step-title">{label(s)}</h3>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <Tabs label={t('output.steps')} idPrefix="output" tabs={STEPS.map((s) => ({ id: s, label: label(s) }))} selected={step.value} onSelect={(s) => (step.value = s)}>
      <h3 class="step-title">{label(step.value)}</h3>
    </Tabs>
  );
}

const QueueBar = () => (
  <footer class="queue-bar" aria-labelledby="queue-title">
    <span id="queue-title" class="strong">
      {t('queue.title')}
    </span>
    <span role="status" class="muted small">
      {t('queue.empty')}
    </span>
  </footer>
);

type MobileView = 'files' | 'editor' | 'mix';

export function Workspace() {
  const filesOpen = useSignal(false);
  const outputOpen = useSignal(false);
  const view = useSignal<MobileView>('editor');
  const current = layout.value;

  if (current === 'desktop') {
    return (
      <div class="workspace desktop">
        <Header />
        <aside class="files-column" aria-label={t('files.title')}>
          <FilesPanel />
        </aside>
        <main id="main" tabIndex={-1} class="center">
          <EditorPanel />
          <MixPanel />
        </main>
        <aside class="output-column" aria-labelledby="output-title">
          <h2 id="output-title" class="panel-title">
            {t('output.title')}
          </h2>
          <OutputSteps tabs={false} />
        </aside>
        <QueueBar />
      </div>
    );
  }

  if (current === 'tablet') {
    return (
      <div class="workspace tablet">
        <Header onFiles={() => (filesOpen.value = true)} />
        <main id="main" tabIndex={-1} class="center">
          <EditorPanel />
          <MixPanel />
        </main>
        <section class="output-dock" aria-labelledby="output-title">
          <h2 id="output-title" class="panel-title">
            {t('output.title')}
          </h2>
          <OutputSteps tabs />
        </section>
        <QueueBar />
        <Dialog open={filesOpen.value} onClose={() => (filesOpen.value = false)} title={t('files.title')} variant="drawer">
          <FileList />
        </Dialog>
      </div>
    );
  }

  const nav: [MobileView, Key, () => JSX.Element][] = [
    ['files', 'files.title', ListIcon],
    ['editor', 'editor.title', WaveIcon],
    ['mix', 'mix.title', MixIcon],
  ];
  return (
    <div class="workspace mobile">
      <Header />
      <main id="main" tabIndex={-1} class="center">
        {view.value === 'files' && <FilesPanel />}
        {view.value === 'editor' && (
          <>
            <EditorPanel />
            <button type="button" class="button wide" onClick={() => (outputOpen.value = true)}>
              <SlidersIcon />
              {t('output.open')}
            </button>
          </>
        )}
        {view.value === 'mix' && <MixPanel />}
      </main>
      <nav class="bottom-nav" aria-label={t('nav.sections')}>
        {nav.map(([id, key, Icon]) => (
          <button key={id} type="button" class="nav-item" aria-current={view.value === id ? 'page' : undefined} onClick={() => (view.value = id)}>
            <Icon />
            {t(key)}
          </button>
        ))}
      </nav>
      <Dialog open={outputOpen.value} onClose={() => (outputOpen.value = false)} title={t('output.title')} variant="sheet">
        <OutputSteps tabs />
      </Dialog>
    </div>
  );
}
