// «Acerca de»: version, licences and links to the code (GPL: serving ffmpeg.wasm obliges to point to
// its source), and «Informar de un error», which copies the technical details for an issue.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { ISSUES_URL, REPO_URL, reportText } from '../app/report.ts';
import { videoEngine } from '../app/settings.ts';
import { useApp } from '../app/state.ts';
import { browserVideoSupport, VIDEO_ENGINES, type VideoEngine } from '../engine/index.ts';
import { lang, t } from '../i18n/index.ts';
import { Dialog } from './Dialog.tsx';
import { layout } from './layout.ts';

declare const __APP_VERSION__: string;

export const aboutOpen = signal(false);

const LIBRARIES: readonly [name: string, licence: string, url: string][] = [
  ['ffmpeg.wasm (@ffmpeg/core, @ffmpeg/ffmpeg)', 'GPL-2.0-or-later, MIT', 'https://github.com/ffmpegwasm/ffmpeg.wasm'],
  ['Mediabunny', 'MPL-2.0', 'https://github.com/Vanilagy/mediabunny'],
  ['Preact, @preact/signals', 'MIT', 'https://github.com/preactjs/preact'],
  ['Valibot', 'MIT', 'https://github.com/fabian-hiller/valibot'],
  ['client-zip', 'MIT', 'https://github.com/Touffy/client-zip'],
  ['SortableJS', 'MIT', 'https://github.com/SortableJS/Sortable'],
  ['Inter', 'OFL-1.1', 'https://github.com/rsms/inter'],
  ['JetBrains Mono', 'OFL-1.1', 'https://github.com/JetBrains/JetBrainsMono'],
];

type Support = { encode: boolean; decode: boolean } | null;

const supportText = (s: Support): string =>
  !s ? t('about.webcodecsChecking') : s.encode && s.decode ? t('about.webcodecsYes') : s.encode ? t('about.webcodecsEncodeOnly') : s.decode ? t('about.webcodecsDecodeOnly') : t('about.webcodecsNo');

/** Who makes the video, and what this browser says it can do; mostly for finding out why a video is slow or fails. */
function VideoEngineSection({ support }: { support: Support }) {
  const label: Record<VideoEngine, string> = { auto: t('about.videoEngine.auto'), ffmpeg: t('about.videoEngine.ffmpeg'), webcodecs: t('about.videoEngine.webcodecs') };
  return (
    <section class="about-section" aria-labelledby="video-engine-title">
      <h3 id="video-engine-title" class="step-title">
        {t('about.videoEngine')}
      </h3>
      <label class="crop-field" for="video-engine">
        {t('about.videoEngineLabel')}
      </label>
      <select id="video-engine" class="input" title={t('about.videoEngineHint')} value={videoEngine.value} onChange={(e) => (videoEngine.value = e.currentTarget.value as VideoEngine)}>
        {VIDEO_ENGINES.map((v) => (
          <option key={v} value={v}>
            {label[v]}
          </option>
        ))}
      </select>
      <p class="muted small" data-testid="webcodecs-support">
        {t('about.webcodecs', { state: supportText(support) })}
      </p>
    </section>
  );
}

function Report({ support }: { support: Support }) {
  const { engine } = useApp();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = reportText({
    version: __APP_VERSION__,
    userAgent: navigator.userAgent,
    isolated: self.crossOriginIsolated === true,
    multithread: engine?.multithread ?? false,
    layout: layout.value,
    language: lang.value,
    jobs: engine?.queue.jobs() ?? [],
    video: { engine: videoEngine.value, webcodecs: support ? `encode ${support.encode}, decode ${support.decode}` : 'unknown' },
  });
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  return (
    <section class="about-section" aria-labelledby="report-title">
      <h3 id="report-title" class="step-title">
        {t('report.title')}
      </h3>
      <div class="row wrap">
        <button type="button" class="button" onClick={copy}>
          {t('report.copy')}
        </button>
        <a class="button" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
          {t('report.open')}
        </a>
      </div>
      <p class="muted small" role="status">
        {state === 'copied' ? t('report.copied') : state === 'failed' ? t('report.copyFailed') : ''}
      </p>
      {state === 'failed' && <textarea class="input mono report-text" readOnly aria-label={t('report.details')} value={text} rows={8} />}
    </section>
  );
}

export function AboutDialog() {
  const [support, setSupport] = useState<Support>(null);
  const open = aboutOpen.value;
  useEffect(() => {
    if (open) void browserVideoSupport().then(setSupport);
  }, [open]);
  if (!open) return null;
  return (
    <Dialog open onClose={() => (aboutOpen.value = false)} title={t('about.title')}>
      <div class="about">
        <p>
          <span class="strong">{t('about.version', { v: __APP_VERSION__ })}</span>
          <br />
          {t('about.license')}
        </p>
        <p class="muted">{t('about.privacy')}</p>
        <p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t('about.code')}
          </a>
        </p>
        <p>
          {t('about.ffmpeg')}{' '}
          <a href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noopener noreferrer">
            {t('about.ffmpegCode')}
          </a>
          {' · '}
          <a href="https://ffmpeg.org/download.html#get-sources" target="_blank" rel="noopener noreferrer">
            {t('about.ffmpegSource')}
          </a>
        </p>
        <section class="about-section" aria-labelledby="libraries-title">
          <h3 id="libraries-title" class="step-title">
            {t('about.libraries')}
          </h3>
          <ul class="about-list">
            {LIBRARIES.map(([name, licence, url]) => (
              <li key={name}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {name}
                </a>{' '}
                <span class="muted small mono">{licence}</span>
              </li>
            ))}
          </ul>
        </section>
        <VideoEngineSection support={support} />
        <Report support={support} />
      </div>
    </Dialog>
  );
}
