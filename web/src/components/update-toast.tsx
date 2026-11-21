// A new build of the app, announced: the service worker (vite.config.ts) finds it on load and once an hour, and a toast
// offers to reload rather than swapping the page under an open note.
// Also the one place the page hears its service worker: a tapped reminder asks the open app to go to its task (sw/sw.ts), an
// address the router takes as it is (`href`), validated by the route it lands on. Reload is a status button (Animate UI's recipe): once
// pressed it says "Reloading…" in place, through a light blur, while the new worker takes over, and back to "Reload" if the page has not gone after a few seconds.
// "Later" hides it until the next hourly check, which offers the same waiting worker again.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Turns } from "@/components/swap";
import { reloadOnTakeover } from "@/lib/update";
import { message } from "@/services/api";
import { useRouter } from "@tanstack/react-router";

const CHECK_MS = 60 * 60 * 1000;
const ID = "update";
/** How long "Reloading…" waits for the page to go before it gives the button back. */
const RELOAD_MS = 4000;

export function UpdateToast() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, r) => setRegistration(r),
  });
  // A worker still waiting after a check is offered again: dismissed with "Later", it fires no new `waiting` event of its own
  useEffect(() => {
    if (!registration) return;
    const check = setInterval(() => { void registration.update().then(() => { if (registration.waiting) setNeedRefresh(true); }); }, CHECK_MS);
    return () => clearInterval(check);
  }, [registration, setNeedRefresh]);
  const router = useRouter();
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const url: unknown = e.data?.type === "navigate" ? e.data.url : null;
      if (typeof url === "string" && /^\/(?![/\\])/.test(url)) void router.navigate({ href: url });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);
  useEffect(() => {
    if (!needRefresh) return;
    // The same id updates the open toast in place, so the label swaps rather than the toast being drawn again
    toast("A new version is ready", {
      id: ID,
      duration: Infinity,
      action: {
        label: <Turns aria-live="polite" state={reloading ? "busy" : "idle"} states={{ idle: "Reload", busy: "Reloading…" }} />,
        onClick: (e) => {
          e.preventDefault();                                 // the toast stays up, showing the status, until the page reloads
          if (reloading) return;
          setReloading(true);
          reloadOnTakeover();                                 // else a page opened before any worker was installed would sit on "Reloading…"
          // The page reloads when the new worker takes over, which this never sees. If it has not by RELOAD_MS (no worker waiting, a
          // failed hand-over), the button is a button again rather than "Reloading…" for good
          updateServiceWorker(true)
            .then(() => new Promise((done) => setTimeout(done, RELOAD_MS)))
            .catch((x: unknown) => { toast.error(message(x)); })
            .finally(() => setReloading(false));
        },
      },
      cancel: { label: "Later", onClick: () => {} },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker, reloading]);
  return null;
}
