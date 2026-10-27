// Keeps the screen on while the queue works, so the phone does not freeze the tab. The browser
// drops the lock when the page is hidden; it is asked for again on return.

export type WakeState = 'unsupported' | 'idle' | 'held' | 'denied';

export interface WakeLock {
  setActive(active: boolean): void;
  state(): WakeState;
  dispose(): void;
}

interface Env {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

export function createWakeLock(
  env: Env = { wakeLock: globalThis.navigator?.wakeLock, document },
  onChange: (state: WakeState) => void = () => {},
): WakeLock {
  let active = false;
  let sentinel: WakeLockSentinel | null = null;
  let state: WakeState = env.wakeLock ? 'idle' : 'unsupported';
  const set = (s: WakeState) => {
    if (s !== state) onChange((state = s));
  };

  const acquire = async () => {
    if (!env.wakeLock || sentinel || env.document.visibilityState !== 'visible') return;
    try {
      const s = await env.wakeLock.request('screen');
      if (!active) return void s.release();
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
        if (state === 'held') set('idle');
      });
      set('held');
    } catch {
      set('denied');
    }
  };

  const release = () => {
    const s = sentinel;
    sentinel = null;
    void s?.release();
    if (state === 'held') set('idle');
  };

  const onVisibility = () => {
    if (active && env.document.visibilityState === 'visible') void acquire();
  };
  env.document.addEventListener('visibilitychange', onVisibility);

  return {
    setActive(next) {
      active = next;
      if (next) void acquire();
      else release();
    },
    state: () => state,
    dispose() {
      active = false;
      release();
      env.document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
