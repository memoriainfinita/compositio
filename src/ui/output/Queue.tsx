// «Exportaciones»: the jobs under way, with their progress, cancel and retry, and the finished
// results, which wait there until downloaded. Nothing downloads by itself: a job that ends opens
// the panel with its results checked. The bar at the foot opens it on desktop and tablet; on
// phones it is a tab of its own.

import { useEffect, useState } from 'preact/hooks';
import { download, finished, separateDownloads, summarize } from '../../app/output.ts';
import { useApp } from '../../app/state.ts';
import type { JobView, Processed } from '../../engine/index.ts';
import { formatNumber, t, type Key } from '../../i18n/index.ts';
import { stem } from '../../model/naming.ts';
import { Dialog } from '../Dialog.tsx';
import { fileSize } from '../format.ts';

function useJobs(): JobView[] {
  const { engine } = useApp();
  const [jobs, setJobs] = useState<JobView[]>(() => engine?.queue.jobs() ?? []);
  useEffect(() => engine?.queue.subscribe(setJobs), [engine]);
  return jobs.filter((j) => j.priority === 'user');
}

const percent = (x: number) => `${formatNumber(Math.round(x * 100))} %`;

function JobRow({ job }: { job: JobView }) {
  const { engine, exports } = useApp();
  const queue = engine!.queue;
  const status = t(`job.${job.status}` as Key);
  const result = job.status === 'done' ? (job.result as Processed | undefined) : undefined;
  const checked = exports.checked.value.has(job.id);
  const check = (on: boolean) => {
    const next = new Set(exports.checked.value);
    if (on) next.add(job.id);
    else next.delete(job.id);
    exports.checked.value = next;
  };
  return (
    <li class={`job ${job.status}`}>
      <div class="job-head">
        {result ? (
          <label class="job-check">
            <input type="checkbox" class="check" checked={checked} onChange={(e) => check(e.currentTarget.checked)} />
            <span class="job-name mono">{job.label}</span>
          </label>
        ) : (
          <span class="job-name mono">{job.label}</span>
        )}
        <span class="muted small">{job.status === 'running' ? percent(job.progress) : result ? fileSize(result.blob.size) : status}</span>
      </div>
      {(job.status === 'running' || job.status === 'queued') && <progress class="job-progress" max={1} value={job.progress} aria-label={`${job.label}: ${status}`} />}
      {job.status === 'failed' && <p class="job-error small">{t(`engineError.${job.error ?? 'ffmpeg-failed'}` as Key)}</p>}
      <div class="job-actions">
        {(job.status === 'running' || job.status === 'queued') && (
          <button type="button" class="button small-button" onClick={() => queue.cancel(job.id)}>
            {t('queue.cancel')}
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button type="button" class="button small-button" onClick={() => queue.retry(job.id)}>
            {t('queue.retry')}
          </button>
        )}
        {result && (
          <button type="button" class="button small-button" onClick={() => void download([{ name: job.label, blob: result.blob }], '', false)}>
            {t('queue.download')}
          </button>
        )}
        {job.status !== 'running' && job.status !== 'queued' && (
          <button type="button" class="button small-button" aria-label={t('queue.removeOne', { name: job.label })} onClick={() => queue.remove(job.id)}>
            {t('queue.remove')}
          </button>
        )}
      </div>
    </li>
  );
}

/** The list and its downloads, in the popup or in the phone's tab. */
export function ExportsList() {
  const { engine, exports, project } = useApp();
  const jobs = useJobs();
  const ready = finished(jobs);
  const marked = ready.filter((r) => exports.checked.value.has(r.id));
  const zipName = `${stem(project.value.name.trim() || 'compositio')}.zip`;
  const separate = separateDownloads();
  const ended = jobs.filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled');
  if (jobs.length === 0) return <p class="empty">{t('queue.empty')}</p>;
  return (
    <>
      <ul class="job-list" title={t('queue.memory')}>
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </ul>
      <div class="row wrap dialog-actions">
        <button type="button" class="button primary" disabled={marked.length === 0} onClick={() => void download(marked, zipName, !separate)}>
          {t('queue.downloadChecked', { n: formatNumber(marked.length) })}
        </button>
        {separate && marked.length > 1 && (
          <button type="button" class="button" onClick={() => void download(marked, zipName, true)}>
            {t('queue.asZip')}
          </button>
        )}
        <button type="button" class="button" disabled={ended.length === 0} onClick={() => ended.forEach((j) => engine?.queue.remove(j.id))}>
          {t('queue.clear')}
        </button>
      </div>
    </>
  );
}

/** What the bar and the phone's tab say: progress while working, then how many are ready. */
export function useExportsStatus(): { text: string; active: boolean; progress: number; any: boolean } {
  const jobs = useJobs();
  const s = summarize(jobs);
  const ready = finished(jobs).length;
  const parts = s.active
    ? [t('queue.summary', { done: formatNumber(s.done), total: formatNumber(s.total) }), percent(s.progress)]
    : ready
      ? [t('queue.ready', { n: ready })]
      : [t('queue.empty')];
  if (s.failed) parts.push(t('queue.failed', { n: s.failed }));
  return { text: parts.join(' · '), active: s.active > 0, progress: s.progress, any: s.total > 0 };
}

/** Desktop and tablet: the bar at the foot, which opens the popup. */
export function QueueBar() {
  const { exports } = useApp();
  const s = useExportsStatus();
  return (
    <footer class="queue-bar" aria-labelledby="queue-title">
      <button type="button" class="queue-open" aria-haspopup="dialog" onClick={() => (exports.open.value = true)} disabled={!s.any}>
        <span id="queue-title" class="strong">
          {t('queue.title')}
        </span>
        <span role="status" class="muted small">
          {s.text}
        </span>
      </button>
      {s.active && <progress class="queue-progress" max={1} value={s.progress} aria-label={t('queue.title')} />}
      <Dialog open={exports.open.value} onClose={() => (exports.open.value = false)} title={t('queue.title')}>
        <ExportsList />
      </Dialog>
    </footer>
  );
}

/** Phones: the tab's panel. */
export function ExportsPanel() {
  const s = useExportsStatus();
  return (
    <section class="card exports" aria-labelledby="exports-title">
      <h2 id="exports-title" class="panel-title">
        {t('queue.title')}
      </h2>
      {s.any && (
        <p role="status" class="muted small">
          {s.text}
        </p>
      )}
      {s.active && <progress class="queue-progress" max={1} value={s.progress} aria-label={t('queue.title')} />}
      <ExportsList />
    </section>
  );
}
