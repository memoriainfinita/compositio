import { describe, expect, it } from 'vitest';
import { createWakeLock, type WakeState } from './wakelock.ts';

class FakeSentinel extends EventTarget {
  released = false;
  async release() {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

function env(visible = true, fail = false) {
  const doc = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden' }) as EventTarget & { visibilityState: string };
  const sentinels: FakeSentinel[] = [];
  const wakeLock = {
    async request() {
      if (fail) throw new DOMException('no', 'NotAllowedError');
      const s = new FakeSentinel();
      sentinels.push(s);
      return s as unknown as WakeLockSentinel;
    },
  };
  return { e: { wakeLock, document: doc as unknown as Document }, doc, sentinels };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('wake lock', () => {
  it('holds the lock while active and lets it go after', async () => {
    const { e, sentinels } = env();
    const states: WakeState[] = [];
    const w = createWakeLock(e, (s) => states.push(s));
    w.setActive(true);
    await tick();
    expect(w.state()).toBe('held');
    w.setActive(false);
    expect(sentinels[0]?.released).toBe(true);
    expect(states).toEqual(['held', 'idle']);
  });

  it('asks again when the page comes back', async () => {
    const { e, doc, sentinels } = env();
    const w = createWakeLock(e);
    w.setActive(true);
    await tick();
    // Hiding the page: the browser releases the lock.
    doc.visibilityState = 'hidden';
    await sentinels[0]?.release();
    expect(w.state()).toBe('idle');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(sentinels).toHaveLength(2);
    expect(w.state()).toBe('held');
    w.dispose();
  });

  it('reports a refusal and a browser without the API', async () => {
    const { e } = env(true, true);
    const w = createWakeLock(e);
    w.setActive(true);
    await tick();
    expect(w.state()).toBe('denied');
    const none = createWakeLock({ document: env().e.document });
    none.setActive(true);
    expect(none.state()).toBe('unsupported');
  });
});
