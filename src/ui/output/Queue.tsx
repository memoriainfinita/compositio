// The queue: the bar at the foot sums up the user's jobs and opens `PopCola`, where each job shows
// its progress and can be cancelled, retried or downloaded; everything finished goes as one zip.

import { useSignal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { finished, save, summarize, zip } from '../../app/output.ts';
import { useApp } from '../../app/state.ts';
import type { JobView, Processed } from '../../engine/index.ts';
import { formatNumber, t, type Key } from '../../i18n/index.ts';
import { stem } from '../../model/naming.ts';
import { Dialog } from '../Dialog.tsx';

function useJobs(): JobView[] {
  const { engine } = useApp();
  const [jobs, setJobs] = useState<JobView[]>(() => engine?.queue.jobs() ?? []);
  useEffect(() => engine?.queue.subscribe(setJobs), [engine]);
  return jobs;
}

const percent = (x: number) => `${formatNumber(Math.round(x * 100))} %`;

function JobRow({ job }: { job: JobView }) {
  const { engine } = useApp();
  const queue = engine!.queue;
  const status = t(`job.${job.status}` as Key);
  return (
    <li class={`job ${job.status}`}>
      <div class="job-head">
        <span class="job-name mono">{job.label}</span>
        <span class="muted small">{job.status === 'running' ? percent(job.progress) : status}</span>
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
        {job.status === 'done' && job.result !== undefined && (
          <button type="button" class="button small-button" onClick={() => save(job.label, (job.result as Processed).blob)}>
            {t('queue.download')}
          </button>
        )}
      </div>
    </li>
  );
}

export function QueueBar() {
  const { engine, project } = useApp();
  const open = useSignal(false);
  const jobs = useJobs().filter((j) => j.priority === 'user');
  const s = summarize(jobs);
  const ready = finished(jobs);
  const text = s.total === 0 ? t('queue.empty') : `${t('queue.summary', { done: formatNumber(s.done), total: formatNumber(s.total) })}${s.active ? ` · ${percent(s.progress)}` : ''}${s.failed ? ` · ${t('queue.failed', { n: s.failed })}` : ''}`;
  return (
    <footer class="queue-bar" aria-labelledby="queue-title">
      <button type="button" class="queue-open" aria-haspopup="dialog" onClick={() => (open.value = true)} disabled={s.total === 0}>
        <span id="queue-title" class="strong">
          {t('queue.title')}
        </span>
        <span role="status" class="muted small">
          {text}
        </span>
      </button>
      {s.active > 0 && <progress class="queue-progress" max={1} value={s.progress} aria-label={t('queue.title')} />}
      <Dialog open={open.value} onClose={() => (open.value = false)} title={t('queue.title')}>
        <ul class="job-list">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </ul>
        <div class="row wrap dialog-actions">
          <button
            type="button"
            class="button primary"
            disabled={ready.length === 0}
            onClick={() => void zip(ready).then((blob) => save(`${stem(project.value.name.trim() || 'compositio')}.zip`, blob))}
          >
            {t('queue.zipAll')}
          </button>
          <button
            type="button"
            class="button"
            disabled={s.done + s.failed === 0}
            onClick={() => jobs.filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled').forEach((j) => engine?.queue.remove(j.id))}
          >
            {t('queue.clear')}
          </button>
        </div>
      </Dialog>
    </footer>
  );
}
