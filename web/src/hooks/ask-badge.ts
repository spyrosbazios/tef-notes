// The dot on the bottom bar's Ask tab: an answer finished while the
// assistant was not in front. Set by the provider when a reply ends with the dock closed; cleared the moment the dock opens.
import { useSyncExternalStore } from "react";
import { dockNow, onDock } from "./dock";

let unread = false;
const subscribers = new Set<() => void>();
const set = (v: boolean) => { if (v === unread) return; unread = v; subscribers.forEach((f) => f()); };

/** A reply ended: unread unless the assistant is on screen to show it. */
export const answered = () => { if (!dockNow().open) set(true); };

onDock(() => { if (dockNow().open) set(false); });

export const useAskUnread = (): boolean =>
  useSyncExternalStore((f) => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => unread);
