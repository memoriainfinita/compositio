import { describe, expect, it } from 'vitest';
import { createQueue } from './queue.ts';
import { EngineError } from './runner.ts';

/** A job that waits until released, or until aborted. */
function gate<R>(value: R) {
  let release!: () => void;
  const started = { value: false };
  const done = new Promise<void>((r) => (release = r));
  const work = ({ signal }: { signal: AbortSignal }) => {
    started.value = true;
    return new Promise<R>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new EngineError('cancelled')));
      void done.then(() => resolve(value));
    });
  };
  return { work, release, started };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('queue', () => {
  it('runs one job at a time, user jobs before background ones', async () => {
    const busy: boolean[] = [];
    const q = createQueue((b) => busy.push(b));
    const first = gate('a');
    const bg = gate('bg');
    const user = gate('u');
    const a = q.add('a', first.work);
    q.add('bg', bg.work, 'background');
    q.add('u', user.work);
    await tick();
    expect(q.jobs().map((j) => j.status)).toEqual(['running', 'queued', 'queued']);
    first.release();
    expect(await a.result).toBe('a');
    await tick();
    expect(user.started.value).toBe(true);
    expect(bg.started.value).toBe(false);
    user.release();
    await tick();
    bg.release();
    await tick();
    expect(q.jobs().map((j) => j.status)).toEqual(['done', 'done', 'done']);
    expect(busy).toEqual([true, false]);
  });

  it('cancels running and queued jobs and keeps going', async () => {
    const q = createQueue();
    const running = gate(1);
    const waiting = gate(2);
    const after = gate(3);
    const r1 = q.add('1', running.work);
    const r2 = q.add('2', waiting.work);
    q.add('3', after.work);
    q.cancel(r2.id);
    await expect(r2.result).rejects.toMatchObject({ code: 'cancelled' });
    q.cancel(r1.id);
    await expect(r1.result).rejects.toMatchObject({ code: 'cancelled' });
    await tick();
    expect(after.started.value).toBe(true);
    expect(waiting.started.value).toBe(false);
    expect(q.jobs().map((j) => j.status)).toEqual(['cancelled', 'cancelled', 'running']);
  });

  it('marks failures with their code, and retries them', async () => {
    const q = createQueue();
    let attempt = 0;
    const job = q.add('x', async ({ onProgress }) => {
      onProgress(0.5);
      if (++attempt === 1) throw new EngineError('out-of-memory', 'boom');
      return 'ok';
    });
    await expect(job.result).rejects.toMatchObject({ code: 'out-of-memory' });
    expect(q.jobs()[0]).toMatchObject({ status: 'failed', error: 'out-of-memory', detail: 'boom', progress: 0.5 });
    q.retry(job.id);
    await tick();
    expect(q.jobs()[0]).toMatchObject({ status: 'done', result: 'ok', progress: 1 });
    expect(q.jobs()[0]?.error).toBeUndefined();
  });

  it('treats unknown errors as ffmpeg failures and removes jobs', async () => {
    const q = createQueue();
    const job = q.add('x', async () => {
      throw new Error('weird');
    });
    await expect(job.result).rejects.toMatchObject({ code: 'ffmpeg-failed' });
    q.remove(job.id);
    expect(q.jobs()).toEqual([]);
  });
});
