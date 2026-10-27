// The single main view («Mesa con inspector»): files, editor and mix, output settings, queue.
// This places each region for each layout.

import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { t, type Key } from '../i18n/index.ts';
import { Dialog } from './Dialog.tsx';
import { EditorPanel } from './editor/Editor.tsx';
import { FileList, FilesHead } from './Files.tsx';
import { Header } from './Header.tsx';
import { ListIcon, MixIcon, SlidersIcon, WaveIcon } from './icons.tsx';
import { layout } from './layout.ts';
import { MixPanel } from './mix/Mix.tsx';
import { Alerts } from './Notices.tsx';
import { Inspector } from './output/Inspector.tsx';
import { OutputFoot, QuickActions } from './output/Presets.tsx';
import { QueueBar } from './output/Queue.tsx';

function FilesPanel({ onActivate }: { onActivate?: () => void }) {
  return (
    <section class="panel files" aria-labelledby="files-title">
      <h2 id="files-title" class="panel-title">
        {t('files.title')}
      </h2>
      <QuickActions />
      <FilesHead />
      <FileList onActivate={onActivate} />
    </section>
  );
}

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
          <Alerts />
          <EditorPanel />
          <MixPanel />
        </main>
        <aside class="output-column" aria-labelledby="output-title">
          <h2 id="output-title" class="panel-title">
            {t('output.title')}
          </h2>
          <Inspector tabs={false} />
          <OutputFoot />
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
          <Alerts />
          <EditorPanel />
          <MixPanel />
        </main>
        <section class="output-dock" aria-labelledby="output-title">
          <h2 id="output-title" class="panel-title">
            {t('output.title')}
          </h2>
          <Inspector tabs />
          <OutputFoot />
        </section>
        <QueueBar />
        <Dialog open={filesOpen.value} onClose={() => (filesOpen.value = false)} title={t('files.title')} variant="drawer">
          <QuickActions />
          <FilesHead />
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
        <Alerts />
        {view.value === 'files' && <FilesPanel onActivate={() => (view.value = 'editor')} />}
        {view.value === 'editor' && (
          <>
            <EditorPanel compact />
            <button type="button" class="button wide" onClick={() => (outputOpen.value = true)}>
              <SlidersIcon />
              {t('output.open')}
            </button>
          </>
        )}
        {view.value === 'mix' && <MixPanel compact />}
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
        <Inspector tabs />
        <OutputFoot />
      </Dialog>
    </div>
  );
}
