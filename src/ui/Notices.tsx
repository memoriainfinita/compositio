// Alerts about added files («Avisos» on the canvas), the analysis under way and the engine download.

import { dismissAlert, type Alert } from '../app/files.ts';
import { MAX_FILE_BYTES } from '../app/intake.ts';
import { useApp } from '../app/state.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { fileSize } from './format.ts';
import { CloseIcon, InfoIcon, WarnIcon } from './icons.tsx';

function text(alert: Alert): [string, string] {
  switch (alert.kind) {
    case 'too-big':
      return [t('alert.tooBig', { name: alert.name }), t('alert.tooBigDetail', { size: fileSize(alert.size), max: fileSize(MAX_FILE_BYTES) })];
    case 'not-media':
      return [t('alert.notMedia', { n: alert.names.length }), t('alert.notMediaDetail', { names: alert.names.join(', ') })];
    case 'single-thread':
      return [t('alert.singleThread'), t('alert.singleThreadDetail')];
  }
}

export function Alerts() {
  const { files } = useApp();
  const alerts = files.alerts.value;
  if (alerts.length === 0) return null;
  return (
    <div class="alerts">
      {alerts.map((alert) => {
        const [title, detail] = text(alert);
        const warn = alert.kind !== 'single-thread';
        return (
          <div key={alert.id} class={`alert${warn ? ' warn' : ''}`} role={warn ? 'alert' : 'status'}>
            {warn ? <WarnIcon /> : <InfoIcon />}
            <div class="alert-text">
              <span class="strong">{title}</span>
              <span class="alert-detail">{detail}</span>
            </div>
            <button type="button" class="icon-button" aria-label={t('alert.close')} title={t('alert.close')} onClick={() => dismissAlert(files, alert.id)}>
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** «Analizando N archivos» while a batch is probed. */
export function Analyzing() {
  const { files } = useApp();
  const now = files.analyzing.value;
  if (!now) return null;
  const label = t('files.analyzing', { n: now.total });
  return (
    <div class="meter" role="status">
      <div class="row small">
        <span>{label}</span>
        <span class="grow" />
        <span class="muted mono">
          {formatNumber(now.done)} / {formatNumber(now.total)}
        </span>
      </div>
      <progress aria-label={label} max={now.total} value={now.done} />
    </div>
  );
}

const MB = 1024 ** 2;

/** The core's download on the start screen. Gone once the engine is ready. */
export function EngineLoading() {
  const { engineLoad } = useApp();
  const load = engineLoad.value;
  if (!load || load.state === 'ready') return null;
  if (load.state === 'failed') {
    return (
      <div class="meter" role="alert">
        <span class="small">{t('home.engineFailed')}</span>
      </div>
    );
  }
  const label = t('home.engine');
  return (
    <div class="meter">
      <div class="row small">
        <span>{label}</span>
        <span class="grow" />
        <span class="muted mono">
          {formatNumber(Math.floor(load.loaded / MB))} / {formatNumber(Math.round(load.total / MB))} MB
        </span>
      </div>
      <progress aria-label={label} max={load.total} value={load.loaded} />
    </div>
  );
}
