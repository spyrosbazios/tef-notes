// Task reminders on this device, as state: whether the browser can take a push at all, whether the server offers it (its key
// route), the permission, and this device's subscription. `enable` asks for the permission, subscribes with the server's key
// and hands the subscription over; `disable` takes it off the server and then the browser. The service worker shows the
// notification (sw/sw.ts), and takes a new subscription to the server when the browser rotates it.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deviceLabel, serverKeyOf, subscriptionOf } from "@/core/push";
import * as svc from "@/services/push";

/** The server's body for a browser subscription; null when the browser gave one the server can't use. */
const bodyOf = (sub: PushSubscription) => subscriptionOf({ ...sub.toJSON(), label: deviceLabel(navigator.userAgent) });

const KEY = ["push-key"] as const, DEVICE = ["push-device"] as const;

/** The browser has what push needs: a service worker, the push manager and notifications (iOS has them only for an installed app). */
export const pushCapable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The registered worker, if the app has one running (a dev server has none, an installed build does). */
const registration = () => navigator.serviceWorker.getRegistration();

export type PushState =
  | { kind: "loading" }
  | { kind: "unavailable"; why: string }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on" };

export function usePush() {
  const qc = useQueryClient();
  const capable = pushCapable();
  const key = useQuery({ queryKey: KEY, queryFn: svc.key, enabled: capable, staleTime: 60_000 });
  const device = useQuery({
    queryKey: DEVICE, enabled: capable,
    queryFn: async () => ({ worker: !!(await registration()), subscribed: !!(await (await registration())?.pushManager.getSubscription()) }),
  });
  // A subscription that exists here may not exist on the server (its record was lost or removed, or the first hand-over never
  // arrived): once per mount, hand it over again, which replaces by endpoint and so changes nothing when it is known. Best
  // effort: offline or a full server leaves the toggle as the browser has it, and the next visit tries again.
  const resynced = useRef(false);
  const subscribed = device.data?.subscribed;
  useEffect(() => {
    if (!subscribed || resynced.current) return;
    resynced.current = true;
    void (async () => {
      const sub = await (await registration())?.pushManager.getSubscription(), body = sub && bodyOf(sub);
      if (body) await svc.subscribe(body);
    })().catch(() => undefined);
  }, [subscribed]);
  const done = () => qc.invalidateQueries({ queryKey: DEVICE });

  const enable = useMutation({
    mutationFn: async () => {
      const bytes = key.data ? serverKeyOf(key.data) : null;
      const reg = await registration();
      if (!bytes || !reg) throw new Error("Reminders aren't available here.");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this app: allow them in the browser's site settings.");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      const body = bodyOf(sub);
      try {
        if (!body) throw new Error("The browser gave a subscription the server can't use.");
        await svc.subscribe(body);
      } catch (e) {
        await sub.unsubscribe();                         // never half on: a subscription the server doesn't know sends nothing
        throw e;
      }
    },
    onSettled: done,
  });

  const disable = useMutation({
    mutationFn: async () => {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (!sub) return;
      await svc.unsubscribe(sub.endpoint);               // the server first: if it can't be reached, the toggle stays on
      await sub.unsubscribe();
    },
    onSettled: done,
  });

  const state: PushState = !capable ? { kind: "unavailable", why: "This browser can't show push notifications. On iPhone, add the app to the Home Screen first." }
    : key.isPending || device.isPending ? { kind: "loading" }
    : key.data == null ? { kind: "unavailable", why: key.isError ? "The server can't be reached." : "The server has push off: it has no VAPID key yet." }
    : !device.data?.worker ? { kind: "unavailable", why: "The app's service worker isn't running here: install the app (or open a built one)." }
    : device.data.subscribed ? { kind: "on" }
    : Notification.permission === "denied" ? { kind: "denied" }
    : { kind: "off" };
  return { state, enable, disable, busy: enable.isPending || disable.isPending };
}
