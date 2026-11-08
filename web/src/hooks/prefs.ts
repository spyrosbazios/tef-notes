// The owner's preferences (core/prefs.ts) as state. The server's record is the truth every device shares; this browser keeps
// a copy (localStorage, hooks/store.ts) so the page paints with them at once and works offline. A change is applied to the copy
// and sent to the server shortly after (several quick ones go as one); until it lands the copy is `dirty`, and a fetch neither
// overwrites it nor stops it being sent again. The server is fetched on start and whenever the window comes back, so a pick
// made on the laptop reaches the phone next time it is opened. `usePrefsSync` does the fetching: mounted once, in root.tsx.
import { useQuery } from "@tanstack/react-query";
import { prefsOf, type Prefs } from "@/core/prefs";
import * as remote from "@/services/prefs";
import { persisted } from "./store";

const KEY = "tefnotes.prefs";

// One-shot: the settings this browser kept per key before they moved to the server become its first copy, which seeds the
// server's record if there is none yet. Delete once every browser has opened the app since (2026-11).
function adopt() {
  if (localStorage.getItem(KEY) !== null) return;
  const old = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? "{}") ?? {}; } catch { return {}; } };
  const look = old("tefnotes.appearance"), view = old("tefnotes.note-view"), agent = old("tefnotes.agent");
  localStorage.setItem(KEY, JSON.stringify(prefsOf({
    theme: look.theme, accent: look.accent,
    notes: { grouped: view.view === "tags", collapsed: view.collapsed, sort: view.sort },
    agent: { model: agent.model, effort: agent.effort, unasked: agent.unasked },
  })));
  ["tefnotes.appearance", "tefnotes.note-view", "tefnotes.agent"].forEach((k) => localStorage.removeItem(k));
}
try { adopt(); } catch { /* storage unavailable: the defaults */ }

const local = persisted<Prefs & { rec?: string; dirty?: boolean }>(KEY, (p) => ({
  ...prefsOf(p), ...(typeof p.rec === "string" && p.rec ? { rec: p.rec } : {}), ...(p.dirty === true ? { dirty: true } : {}),
}));

const strip = ({ rec: _r, dirty: _d, ...p }: Prefs & { rec?: string; dirty?: boolean }): Prefs => p;

/** The preferences now, for code outside a component. */
export const prefsNow = (): Prefs => strip(local.read());

/** The preferences; every component using them follows a change. */
export function usePrefs(): Prefs {
  const [p] = local.use();
  return strip(p);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let sending: Promise<void> | null = null;

/** Send the copy if it has changes. A failure (offline, server down) leaves it dirty for the next fetch to send. */
function send(): Promise<void> {
  if (sending) return sending.then(() => send());
  const now = local.read();
  if (!now.dirty) return Promise.resolve();
  sending = remote.save(now.rec ?? null, strip(now))
    .then((s) => {
      // Only clear `dirty` when nothing changed while it was in flight.
      const after = local.read();
      local.set(JSON.stringify(strip(after)) === JSON.stringify(strip(now)) ? { rec: s.rec, dirty: undefined } : { rec: s.rec });
    })
    .catch(async () => {
      // Created by another device meanwhile: take its record and send ours over it.
      if (!now.rec) { const s = await remote.get().catch(() => null); if (s) local.set({ rec: s.rec }); }
    })
    .finally(() => { sending = null; });
  return sending;
}

/** Merge `patch` into the preferences, here at once and on the server shortly. */
export function setPrefs(patch: Partial<Prefs>) {
  local.set({ ...patch, dirty: true });
  clearTimeout(timer);
  timer = setTimeout(() => void send(), 400);
}

/** Fetches the server's preferences into the copy, or sends the copy when it has changes or the server has none. */
export function usePrefsSync() {
  useQuery({
    queryKey: ["prefs"], refetchOnWindowFocus: true, staleTime: 0,
    queryFn: async () => {
      const s = await remote.get();
      if (s && !local.read().dirty) local.set({ ...s.prefs, rec: s.rec });
      else {
        if (s) local.set({ rec: s.rec });
        local.set({ dirty: true });
        await send();
      }
      return true;
    },
  });
}
