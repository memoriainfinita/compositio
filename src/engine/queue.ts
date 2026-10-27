// Job queue: one job at a time, the user's before background analysis. A failed or cancelled job
// never stops the queue; it stays marked and can be retried.

import { classify, EngineError, type EngineErrorCode, type RunOptions } from './runner.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
/** `user` jobs show in the queue popup; `background` ones (probe, silences) do not. */
export type Priority = 'user' | 'background';

export interface JobView<R = unknown> {
  id: string;
  label: string;
  priority: Priority;
  status: JobStatus;
  progress: number;
  result?: R;
  error?: EngineErrorCode;
  detail?: string;
}

type Work<R> = (options: Required<Pick<RunOptions, 'signal' | 'onProgress'>>) => Promise<R>;

interface Entry<R> {
  view: JobView<R>;
  work: Work<R>;
  controller: AbortController | null;
  settle: { resolve: (r: R) => void; reject: (e: EngineError) => void };
}

export interface Queue {
  add<R>(label: string, work: Work<R>, priority?: Priority): { id: string; result: Promise<R> };
  cancel(id: string): void;
  /** Queues a failed or cancelled job again; its result arrives in the job's view. */
  retry(id: string): void;
  /** Forgets a finished job and its result; cancels it first if needed. */
  remove(id: string): void;
  jobs(): JobView[];
  busy(): boolean;
  subscribe(listener: (jobs: JobView[]) => void): () => void;
}

let counter = 0;

export function createQueue(onBusyChange: (busy: boolean) => void = () => {}): Queue {
  const entries: Entry<unknown>[] = [];
  const listeners = new Set<(jobs: JobView[]) => void>();
  let running: Entry<unknown> | null = null;
  let wasBusy = false;

  const snapshot = (): JobView[] => entries.map((e) => ({ ...e.view }));
  const emit = () => {
    const busy = running !== null || entries.some((e) => e.view.status === 'queued');
    if (busy !== wasBusy) {
      wasBusy = busy;
      onBusyChange(busy);
    }
    const jobs = snapshot();
    for (const l of listeners) l(jobs);
  };

  const next = (): Entry<unknown> | undefined =>
    entries.find((e) => e.view.status === 'queued' && e.view.priority === 'user') ??
    entries.find((e) => e.view.status === 'queued');

  const pump = () => {
    if (running) return;
    const entry = next();
    if (!entry) return emit();
    running = entry;
    const controller = new AbortController();
    entry.controller = controller;
    entry.view.status = 'running';
    entry.view.progress = 0;
    delete entry.view.error;
    delete entry.view.detail;
    emit();
    const onProgress = (ratio: number) => {
      if (running !== entry) return;
      entry.view.progress = ratio;
      emit();
    };
    entry
      .work({ signal: controller.signal, onProgress })
      .then(
        (result) => {
          entry.view.status = 'done';
          entry.view.progress = 1;
          entry.view.result = result;
          entry.settle.resolve(result);
        },
        (e: unknown) => {
          const error = classify(e, [], controller.signal.aborted);
          entry.view.status = error.code === 'cancelled' ? 'cancelled' : 'failed';
          entry.view.error = error.code;
          entry.view.detail = error.detail;
          entry.settle.reject(error);
        },
      )
      .finally(() => {
        entry.controller = null;
        running = null;
        pump();
      });
  };

  const find = (id: string) => entries.find((e) => e.view.id === id);

  return {
    add<R>(label: string, work: Work<R>, priority: Priority = 'user') {
      const id = `job-${++counter}`;
      let settle!: Entry<R>['settle'];
      const result = new Promise<R>((resolve, reject) => (settle = { resolve, reject }));
      // Callers that only watch the views need not handle the rejection.
      result.catch(() => {});
      const entry: Entry<R> = { view: { id, label, priority, status: 'queued', progress: 0 }, work, controller: null, settle };
      entries.push(entry as Entry<unknown>);
      emit();
      pump();
      return { id, result };
    },
    cancel(id) {
      const e = find(id);
      if (!e) return;
      if (e.view.status === 'running') e.controller?.abort();
      else if (e.view.status === 'queued') {
        e.view.status = 'cancelled';
        e.view.error = 'cancelled';
        e.settle.reject(new EngineError('cancelled'));
        emit();
      }
    },
    retry(id) {
      const e = find(id);
      if (!e || (e.view.status !== 'failed' && e.view.status !== 'cancelled')) return;
      e.view.status = 'queued';
      e.view.progress = 0;
      e.settle = { resolve: () => {}, reject: () => {} };
      emit();
      pump();
    },
    remove(id) {
      const e = find(id);
      if (!e) return;
      if (e.view.status === 'running' || e.view.status === 'queued') this.cancel(id);
      entries.splice(entries.indexOf(e), 1);
      emit();
    },
    jobs: snapshot,
    busy: () => wasBusy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
