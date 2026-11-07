// A new build of the app, announced: the service worker (vite.config.ts) finds it on load and once an hour, and a toast
// offers to reload rather than swapping the page under an open note. Dismissed, it stays away until the next check.
import { useEffect } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";

const CHECK_MS = 60 * 60 * 1000;
const ID = "update";

export function UpdateToast() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, r) => { if (r) setInterval(() => { void r.update(); }, CHECK_MS); },
  });
  useEffect(() => {
    if (!needRefresh) return;
    toast("A new version is ready", {
      id: ID,
      duration: Infinity,
      action: { label: "Reload", onClick: () => { void updateServiceWorker(true); } },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
  return null;
}
