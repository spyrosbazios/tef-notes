// A new build of the app, announced: the service worker (vite.config.ts) finds it on load and once an hour, and a toast
// offers to reload rather than swapping the page under an open note. Dismissed, it stays away until the next check.
// Also the one place the page hears its service worker: a tapped reminder asks the open app to go to its task (sw/sw.ts), an
// address the router takes as it is (`href`), validated by the route it lands on.
import { useEffect } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useRouter } from "@tanstack/react-router";

const CHECK_MS = 60 * 60 * 1000;
const ID = "update";

export function UpdateToast() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, r) => { if (r) setInterval(() => { void r.update(); }, CHECK_MS); },
  });
  const router = useRouter();
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
    toast("A new version is ready", {
      id: ID,
      duration: Infinity,
      action: { label: "Reload", onClick: () => { void updateServiceWorker(true); } },
      cancel: { label: "Later", onClick: () => {} },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
  return null;
}
