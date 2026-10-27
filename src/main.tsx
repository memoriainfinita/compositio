import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './ui/theme.css';
import './ui/app.css';
import { render } from 'preact';
import { createMontageLibrary } from './app/montages.ts';
import { createPresetStore, starterPresets } from './app/presets.ts';
import { takeShared, wasShared } from './app/share.ts';
import { createAppState } from './app/state.ts';
import { createEngine } from './engine/index.ts';
import { bindDocumentLang, lang, resolveLang, t } from './i18n/index.ts';
import type { Preset } from './model/formats.ts';
import { emptyProject } from './model/project.ts';
import { createStore } from './model/store.ts';
import { createAutosave, openStorage, type Storage } from './model/storage.ts';
import { startServiceWorker } from './sw/register.ts';
import { takeIn } from './ui/adding.ts';
import { App } from './ui/App.tsx';
import { installPrompt, type InstallPrompt } from './ui/Home.tsx';
import { announce, watchLayout } from './ui/layout.ts';

const root = document.documentElement;

async function boot() {
  bindDocumentLang();
  watchLayout();

  // Private modes or blocked storage: the app still works, it just does not remember.
  const storage: Storage | null = await openStorage().catch(() => null);
  const settings = await storage?.loadSettings();
  if (settings?.ok && settings.value) lang.value = resolveLang(settings.value.language, navigator.languages);
  const session = (await storage?.loadSession()) ?? { ok: true as const, value: null };

  const store = createStore(session.ok && session.value ? session.value : emptyProject());
  // A saved session this version cannot read is never overwritten: a newer version may still.
  if (storage && session.ok) {
    const autosave = createAutosave((p: ReturnType<typeof store.get>) => storage.saveSession(p), (e) => console.error('autosave', e));
    store.subscribe((p) => autosave.schedule(p));
    addEventListener('pagehide', () => void autosave.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void autosave.flush());
  } else if (!session.ok) {
    console.warn('saved session not readable', session.error);
  }

  // Presets this version cannot read are never overwritten either; a first run gets the starters.
  const loaded = (await storage?.loadPresets()) ?? { ok: true as const, value: null };
  const save = (list: readonly Preset[]) => void storage?.savePresets(list).catch((e) => console.error('presets', e));
  const presets = loaded.ok
    ? createPresetStore(loaded.value ?? starterPresets([t('preset.wav'), t('preset.theatre'), t('preset.mp3')]), save)
    : createPresetStore([], () => {});
  if (loaded.ok && loaded.value === null) save(presets.list.value);

  const records = (await storage?.listMontages().catch(() => [])) ?? [];
  const montages = createMontageLibrary(records, {
    put: (r) => storage?.putMontage(r) ?? Promise.resolve(),
    remove: (id) => storage?.deleteMontage(id) ?? Promise.resolve(),
  });

  const engine = createEngine();
  const app = createAppState(store, engine, presets, montages);
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.value = e as unknown as InstallPrompt;
  });
  render(<App state={app} />, document.getElementById('app')!);
  root.dataset.app = 'ready';

  // Files shared from another app arrive as if they had been dropped.
  if (wasShared()) {
    history.replaceState(null, '', location.pathname);
    void takeShared().then(async (shared) => {
      const ids = await takeIn(app, shared.map((file) => ({ file, path: file.name })));
      if (ids.length) announce(t('share.received', { n: ids.length }));
    });
  }

  void startServiceWorker((apply) => (app.update.value = apply));

  // The engine loads while the person looks at the start screen (canvas «Inicio»).
  if (import.meta.env.PROD) {
    root.dataset.engine = 'loading';
    engine.warmUp((loaded, total) => (app.engineLoad.value = { state: 'loading', loaded, total })).then(
      () => {
        root.dataset.engine = 'ready';
        app.engineLoad.value = { state: 'ready' };
      },
      (e) => {
        root.dataset.engine = 'failed';
        app.engineLoad.value = { state: 'failed' };
        console.error('engine', e);
      },
    );
  }
}

void boot();
