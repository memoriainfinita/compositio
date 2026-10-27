// Start screen while the project is empty («Inicio» on the canvas).

import { useApp } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { chooseFiles } from './adding.ts';
import { Header } from './Header.tsx';
import { Logo } from './Logo.tsx';
import { Alerts, Analyzing, EngineLoading } from './Notices.tsx';

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
              {/* The example arrives in step 11. */}
              <button type="button" class="button" disabled>
                {t('home.example')}
              </button>
            </div>
          </div>
          <Analyzing />
          <Alerts />
          <EngineLoading />
        </div>
      </main>
    </div>
  );
}
