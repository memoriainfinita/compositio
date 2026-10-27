import { useEffect } from 'preact/hooks';
import { AppContext, useApp, type AppState } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { dragging, useDropAnywhere } from './adding.ts';
import { Home } from './Home.tsx';
import { announcement } from './layout.ts';
import { MontageDialogs } from './Montages.tsx';
import { Workspace } from './Workspace.tsx';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo; fields keep their own undo. */
function useUndoKeys() {
  const { store } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || editable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) store.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') store.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}

function Shell() {
  const app = useApp();
  const { project, update } = app;
  useUndoKeys();
  useDropAnywhere(app);
  const apply = update.value;
  return (
    <>
      <a class="skip-link" href="#main">
        {t('app.skip')}
      </a>
      {project.value.files.length === 0 ? <Home /> : <Workspace />}
      <MontageDialogs />
      {dragging.value && (
        <div class="drop-overlay" aria-hidden="true">
          <span>{t('home.drop')}</span>
        </div>
      )}
      {apply && (
        <div class="update-banner" role="status">
          <button type="button" class="button primary" onClick={apply}>
            {t('app.update')}
          </button>
        </div>
      )}
      <div class="visually-hidden" aria-live="polite">
        {announcement.value}
      </div>
    </>
  );
}

export function App({ state }: { state: AppState }) {
  return (
    <AppContext.Provider value={state}>
      <Shell />
    </AppContext.Provider>
  );
}
