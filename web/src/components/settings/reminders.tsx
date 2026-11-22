// Settings → Reminders: Web Push on this device.
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Group, Page, Row } from "@/components/settings/kit";
import { Switch } from "@/components/ui/switch";
import { usePush } from "@/hooks/push";
import { message } from "@/services/api";

/** Task reminders on this device: Web Push. The server sends a task's reminder at its time, whether or not the app is open; the
 *  service worker shows it and a tap opens the task. */
export function Reminders() {
  const { state, enable, disable, busy } = usePush();
  const on = state.kind === "on", blocked = state.kind === "unavailable" || state.kind === "denied";
  const flip = (v: boolean) => (v ? enable : disable).mutate(undefined, {
    onSuccess: () => toast(v ? "Reminders are on for this device" : "Reminders are off for this device"),
    onError: (e) => toast.error(message(e)),
  });
  const detail = state.kind === "unavailable" ? `Not available: ${state.why}`
    : state.kind === "denied" ? "Blocked: allow notifications in the browser's site settings."
    : undefined;
  return (
    <Page title="Reminders">
      <Group hint="Rings at a task's reminder time, even with the app closed.">
        <Row icon={blocked ? BellOff : Bell} tone={on ? "brand" : blocked ? "down" : "dim"} title="On this device" detail={detail} htmlFor="push-on">
          {busy || state.kind === "loading" ? <Loader2 className="size-4 animate-spin text-dim" /> : null}
          <Switch id="push-on" checked={on} disabled={busy || state.kind === "loading" || blocked} onCheckedChange={flip} />
        </Row>
      </Group>
    </Page>
  );
}
