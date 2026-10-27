// Start screen while the project is empty («Inicio» on the canvas). Its actions arrive in step 6.

import { t } from '../i18n/index.ts';
import { Header } from './Header.tsx';
import { Logo } from './Logo.tsx';

export function Home() {
  return (
    <div class="home">
      <Header home />
      <main id="main" tabIndex={-1} class="home-main">
        <div class="drop-zone">
          <Logo size={96} muted />
          <h1 class="drop-title">{t('home.drop')}</h1>
          <div class="row wrap justify-center">
            <button type="button" class="button primary" disabled>
              {t('home.choose')}
            </button>
            <button type="button" class="button" disabled>
              {t('home.example')}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
