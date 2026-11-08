// Fetching a new build now, for when the update toast (components/update-toast.tsx) is slow to notice one: ask the
// service worker to check, let a waiting one take over (sw/sw.ts handles SKIP_WAITING), then reload.
declare const __APP_VERSION__: string;
export const appVersion = (): string => __APP_VERSION__;

export async function forceUpdate(): Promise<void> {
  const r = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (r) {
    await r.update().catch(() => {});
    const next = r.waiting ?? (await installed(r));
    if (next) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
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
