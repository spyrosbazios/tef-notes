// Lenses (core/lens.ts) on the phone: the definitions as the server has them, kept in their own MMKV file like tag
// definitions so the switcher works offline, and *which* lens is on, a pref of this phone (`lensRec`; none is the
// unfiltered app). Every screen reads the one active lens through `useActiveLens`; the stores that make notes and tasks
// read it with `activeLensNow`. A lens deleted elsewhere resolves to none (`activeLens`). Failures are silent: the
// cached list stays.
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { activeLens, type Lens, type LensFields } from "@/core/lens";
import * as pb from "@/core/pocketbase";
import { serverOf, useKeys } from "./keys";
import { usePrefs } from "./prefs";
import { mmkvStorage } from "./storage";

export const useLenses = create<{ lenses: Lens[] }>()(
  persist(
    () => ({ lenses: [] as Lens[] }),
    { name: "lenses", storage: createJSONStorage(() => mmkvStorage("lenses").storage), partialize: ({ lenses }) => ({ lenses }),
      // v2: lenses gained `exclude` (v1) and `accent`; one-shot, delete once every phone has run it.
      version: 2, migrate: (old) => ({ lenses: ((old as { lenses?: Lens[] })?.lenses ?? []).map((l) => ({ ...l, exclude: l.exclude ?? [], accent: l.accent ?? null })) }) },
  ),
);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The server's lenses into the store, unless they are the ones held (so a refresh doesn't redraw every list). Offline or
 *  failing: what is cached stays. */
export async function refreshLenses(): Promise<void> {
  const s = serverOf();
  if (!s) return;
  try {
    const lenses = await pb.lenses.list(s);
    if (!same(lenses, useLenses.getState().lenses)) useLenses.setState({ lenses });
  } catch { /* the cached list stays */ }
}

/** A lens made, or changed (`rec`), on the server, then re-read. Throws what the server said, so the form can show it. */
export async function saveLens(rec: string | null, fields: LensFields): Promise<void> {
  const s = serverOf();
  if (!s) throw new Error("No server set");
  if (rec) await pb.lenses.update(s, rec, fields); else await pb.lenses.create(s, fields);
  await refreshLenses();
}

/** A lens removed from the server (and switched off here when it was the one on), then the list re-read. */
export async function deleteLens(rec: string): Promise<void> {
  const s = serverOf();
  if (!s) throw new Error("No server set");
  await pb.lenses.remove(s, rec);
  if (usePrefs.getState().lensRec === rec) setActiveLens(null);
  await refreshLenses();
}

/** Turn the lens `rec` on, or all lenses off (null). */
export const setActiveLens = (rec: string | null) => usePrefs.getState().set({ lensRec: rec });

/** The lens on right now, outside a render (the stores that make notes and tasks, the assistant's context, the widgets). */
export const activeLensNow = (): Lens | null => activeLens(useLenses.getState().lenses, usePrefs.getState().lensRec);

/** The lens on, for a screen: re-renders when it is switched or its definition changes. null: none. */
export function useActiveLens(): Lens | null {
  const lenses = useLenses((s) => s.lenses), rec = usePrefs((s) => s.lensRec);
  return useMemo(() => activeLens(lenses, rec), [lenses, rec]);
}

/** Definitions are read on launch, on coming to the front (the laptop may have changed them) and when the server is set. */
export function useLensSync() {
  const server = useKeys((s) => s.keys.server);
  useEffect(() => {
    void refreshLenses();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void refreshLenses(); });
    return () => sub.remove();
  }, [server]);
}
