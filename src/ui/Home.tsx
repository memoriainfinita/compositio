// Start screen while the project is empty («Inicio» on the canvas).

import { signal } from '@preact/signals';
import { exampleFiles } from '../app/example.ts';
import { useApp, type AppState } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { addClips } from '../model/project.ts';
import { chooseFiles, takeIn } from './adding.ts';
import { Header } from './Header.tsx';
import { Logo } from './Logo.tsx';
import { Alerts, Analyzing, EngineLoading } from './Notices.tsx';
import { QuickActions } from './output/Presets.tsx';

/** The browser's offer to install the app (`beforeinstallprompt`, Chromium only). */
export interface InstallPrompt {
  prompt(): Promise<unknown>;
}
export const installPrompt = signal<InstallPrompt | null>(null);

/** The sample tracks go in as files and into the mix, so every part of the app has something. */
async function tryExample(app: AppState) {
  const ids = await takeIn(app, exampleFiles([t('example.1'), t('example.2'), t('example.3')]).map((file) => ({ file, path: file.name })));
  if (ids.length) app.store.run((p) => addClips(p, ids));
}

function Install() {
  const offer = installPrompt.value;
  if (!offer) return null;
  return (
    <div class="install">
      <span class="grow">{t('home.install')}</span>
      <button
        type="button"
        class="button small-button"
        onClick={() => {
          installPrompt.value = null;
          void offer.prompt();
        }}
      >
        {t('home.installButton')}
      </button>
    </div>
  );
}

export function Home() {
  const app = useApp();
  return (
    <div class="home">
      <Header home />
      <main id="main" tabIndex={-1} class="home-main">
        <div class="home-stack">
          <div class="drop-zone">
            <Logo size={96} muted />
            <h1 class="drop-title">{t('home.drop')}</h1>
            <div class="row wrap justify-center">
              <button type="button" class="button primary" onClick={() => chooseFiles(app)}>
                {t('home.choose')}
              </button>
              <button type="button" class="button" disabled={!app.engine} onClick={() => void tryExample(app)}>
                {t('home.example')}
              </button>
            </div>
          </div>
          <QuickActions />
          <Analyzing />
          <Alerts />
          <EngineLoading />
          <Install />
        </div>
      </main>
    </div>
  );
}
