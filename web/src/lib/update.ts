// Fetching a new build now, for when the update toast (components/update-toast.tsx) is slow to notice one: ask the
// service worker to check, let a waiting one take over (sw/sw.ts handles SKIP_WAITING), then reload.
declare const __APP_VERSION__: string;
export const appVersion = (): string => __APP_VERSION__;

/** Reload the page once a new service worker takes it over. Both ways of updating (this file's `forceUpdate` and the toast's
 *  Reload) call it before asking the worker to skip waiting: the plugin's own reload only fires when a worker controlled the page
 *  when it loaded, so a page opened before any worker was installed (a first visit) would otherwise never reload. */
export function reloadOnTakeover(): void {
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
}

export async function forceUpdate(): Promise<void> {
  const r = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (r) {
    await r.update().catch(() => {});
    const next = r.waiting ?? (await installed(r));
    if (next) {
      reloadOnTakeover();
      next.postMessage({ type: "SKIP_WAITING" });
      return;
    }
  }
  location.reload();
}

/** A worker still installing after the check, once it has installed; none if it fails or nothing new was found. */
function installed(r: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const w = r.installing;
  if (!w) return Promise.resolve(null);
  return new Promise((done) => {
    w.addEventListener("statechange", () => {
      if (w.state === "installed") done(w);
      else if (w.state === "redundant") done(null);
    });
  });
}
