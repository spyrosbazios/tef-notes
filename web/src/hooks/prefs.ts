// The owner's preferences (core/prefs.ts) as state, kept in step with the server by the core's engine (core/prefs-sync.ts).
// This browser's copy is in localStorage (lib/storage-keys.ts `STORAGE.prefs`), so the page paints with it at once (the boot
// script reads its theme and accent) and works offline. A change is on the copy at once and goes to the server shortly after,
// several quick ones as one, carrying only what changed. The server is pulled on start, when the window comes back
// (`usePrefsSync`, mounted once in root.tsx) and after the realtime feed was down; another device's save arrives over the feed
// (`takePrefs` and `pullPrefs`, called by hooks/notes.ts `useLive`).
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { isPrefPath, PREFS_KEY, prefsOf, type LayoutPrefs, type Prefs, type PrefsPatch } from "@/core/prefs";
import { prefsSync, type PrefsCopy } from "@/core/prefs-sync";
import { STORAGE } from "@/lib/storage-keys";
import * as remote from "@/services/prefs";
import { layoutNow } from "./media";
import { persisted } from "./store";

// Stored flat, `dirty` beside the preferences' own keys: the boot script reads `theme` and `accent` at the top
type Stored = Prefs & { dirty?: string[] };
const local = persisted<Stored>(STORAGE.prefs, (p) => {
  const dirty = Array.isArray(p.dirty) ? p.dirty.filter(isPrefPath) : [];
  return { ...prefsOf(p), ...(dirty.length ? { dirty } : {}) };
});

// The copy as the engine and React read it: one object per stored value, as useSyncExternalStore needs until the value changes
let seen: { stored: Stored; copy: PrefsCopy } | undefined;
function copy(): PrefsCopy {
  const stored = local.read();
  if (seen?.stored !== stored) {
    const { dirty = [], ...prefs } = stored;
    seen = { stored, copy: { prefs, dirty } };
  }
  return seen.copy;
}

const sync = prefsSync({ read: copy, write: (c) => local.replace({ ...c.prefs, ...(c.dirty.length ? { dirty: c.dirty } : {}) }) }, remote);

/** The preferences now, for code outside a component. */
export const prefsNow = (): Prefs => copy().prefs;

/** The preferences; every component using them follows a change. */
export const usePrefs = (): Prefs => useSyncExternalStore(local.subscribe, prefsNow);

/** The preferences of the layout the window is drawn in now (core/prefs.ts `Layout`), for code outside a component. */
export const layoutPrefsNow = (): LayoutPrefs => prefsNow()[layoutNow()];

let timer: ReturnType<typeof setTimeout> | undefined;

/** `patch` into the preferences, here at once and on the server shortly. A group takes only the fields given:
 *  `setPrefs({ notes: { sort } })` leaves the rest of `notes` as it is. */
export function setPrefs(patch: PrefsPatch) {
  sync.set(patch);
  clearTimeout(timer);
  timer = setTimeout(() => void sync.push(), 400);
}

/** A `prefs` record from the realtime feed: the owner's becomes the copy, what is unsent here kept over it. */
export function takePrefs(record: { id: string; key?: unknown; data?: unknown }) {
  if (record.key === PREFS_KEY) sync.take({ rec: record.id, prefs: prefsOf(record.data) });
}

/** Fetches the server's preferences into the copy, then sends what is unsent here. */
export const pullPrefs = (): Promise<void> => sync.pull();

/** Pulls on start and whenever the window comes back. */
export function usePrefsSync() {
  useQuery({ queryKey: ["prefs"], refetchOnWindowFocus: true, staleTime: 0, queryFn: async () => { await pullPrefs(); return true; } });
}
