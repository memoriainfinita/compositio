// Registers the service worker. It reloads the page once when that is the only way to get the
// isolation headers, and reports new versions without applying them: the user decides when.

const ISOLATION_RELOAD = 'compositio:isolation-reload';

export type ApplyUpdate = () => void;

export async function startServiceWorker(onUpdate: (apply: ApplyUpdate) => void): Promise<void> {
  const sw = navigator.serviceWorker;
  if (!sw || import.meta.env.DEV) return;

  if (self.crossOriginIsolated) sessionStorage.removeItem(ISOLATION_RELOAD);

  // Reload when the worker that now controls the page is needed: to get isolated, or because
  // the user accepted a new version here. Firefox also fires this on a page already isolated by
  // the same worker; reloading then would only interrupt. A version accepted in another tab
  // does not reload this one either.
  let reloading = false;
  let accepted = false;
  sw.addEventListener('controllerchange', () => {
    if (reloading || (self.crossOriginIsolated && !accepted)) return;
    reloading = true;
    location.reload();
  });

  const registration = await sw.register('./sw.js', { scope: './' });

  // Active worker but uncontrolled page (a hard reload bypasses the worker): reload once.
  // The flag stops a loop where the browser never isolates; the app then runs single-threaded.
  if (!sw.controller && registration.active && !sessionStorage.getItem(ISOLATION_RELOAD)) {
    sessionStorage.setItem(ISOLATION_RELOAD, '1');
    reloading = true;
    location.reload();
    return;
  }

  const offer = (worker: ServiceWorker) =>
    onUpdate(() => {
      accepted = true;
      worker.postMessage({ type: 'skip-waiting' });
    });
  if (registration.waiting && sw.controller) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && sw.controller) offer(worker);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });
}
