import { useApp } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { aboutOpen } from './About.tsx';
import { FolderIcon, InfoIcon, ListIcon, RedoIcon, UndoIcon } from './icons.tsx';
import { layout } from './layout.ts';
import { Logo } from './Logo.tsx';
import { montageDialog } from './Montages.tsx';

interface Props {
  /** The start screen: no undo, and opening a montage instead of the montage menu. */
  home?: boolean;
  /** Tablet: opens the files panel. */
  onFiles?: () => void;
}

export function Header({ home = false, onFiles }: Props) {
  const { store, project, canUndo, canRedo } = useApp();
  const compact = layout.value === 'mobile';
  const files = project.value.files.length;

  return (
    <header class="app-header">
      {onFiles && (
        <button type="button" class="button" aria-label={`${t('header.files')}: ${t('files.count', { n: files })}`} title={t('header.files')} onClick={onFiles}>
          <ListIcon />
          <span aria-hidden="true">{files}</span>
        </button>
      )}
      <Logo />
      {/* The workspace has no other first-level heading; the start screen has its own. */}
      {home ? <span class="app-name">compositio</span> : <h1 class="app-name">compositio</h1>}
      {!home && !compact && <span class="montage-name">{project.value.name || t('header.untitled')}</span>}
      <div class="grow" />
      {!home && (
        <>
          <button type="button" class="icon-button" aria-label={t('header.undo')} title={t('header.undo')} disabled={!canUndo.value} onClick={() => store.undo()}>
            <UndoIcon />
          </button>
          <button type="button" class="icon-button" aria-label={t('header.redo')} title={t('header.redo')} disabled={!canRedo.value} onClick={() => store.redo()}>
            <RedoIcon />
          </button>
        </>
      )}
      <button type="button" class="icon-button" aria-label={t('header.about')} title={t('header.about')} aria-haspopup="dialog" onClick={() => (aboutOpen.value = true)}>
        <InfoIcon />
      </button>
      {compact && !home ? (
        <button type="button" class="icon-button" aria-label={t('header.montages')} title={t('header.montages')} aria-haspopup="dialog" onClick={() => (montageDialog.value = 'library')}>
          <FolderIcon />
        </button>
      ) : (
        <>
          <button type="button" class="button" aria-haspopup="dialog" onClick={() => (montageDialog.value = 'library')}>
            {t('montage.open')}
          </button>
          {!home && (
            <button type="button" class="button" aria-haspopup="dialog" onClick={() => (montageDialog.value = 'save')}>
              {t('montage.save')}
            </button>
          )}
        </>
      )}
    </header>
  );
}
