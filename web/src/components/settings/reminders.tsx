// Settings → Reminders: Web Push on this device.
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TITLE } from "@/components/settings/style";
import { Switch } from "@/components/ui/switch";
import { usePush } from "@/hooks/push";
import { message } from "@/services/api";

/** Task reminders on this device: Web Push. The server sends a task's reminder at its time, whether or not the app is open; the
 *  service worker shows it and a tap opens the task. */
export function Reminders() {
  const { state, enable, disable, busy } = usePush();
  const on = state.kind === "on";
  const flip = (v: boolean) => (v ? enable : disable).mutate(undefined, {
    onSuccess: () => toast(v ? "Reminders are on for this device" : "Reminders are off for this device"),
    onError: (e) => toast.error(message(e)),
  });
  const detail = state.kind === "unavailable" ? `Not available: ${state.why}`
    : state.kind === "denied" ? "Notifications are blocked for this app. Allow them in the browser's site settings, then turn this on."
    : "Rings at a task's reminder time, even when the app is closed.";
  return (
    <section className="space-y-3" aria-labelledby="reminders-h">
      <h2 id="reminders-h" className={TITLE}>Reminders</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <label className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Task reminders on this device</span>
            <span className="block text-[13px] leading-snug text-dim">{detail}</span>
          </span>
          {busy || state.kind === "loading" ? <Loader2 className="size-4 animate-spin text-dim" /> : null}
          <Switch checked={on} disabled={busy || state.kind === "loading" || state.kind === "unavailable" || state.kind === "denied"} onCheckedChange={flip} aria-label="Task reminders on this device" />
        </label>
      </div>
    </section>
  );
}
