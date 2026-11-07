// Where the notes server is: Android Keystore-backed via SecureStore. Typed in on the phone, never in the repo or
// the bundle. The phone holds no model keys: the agent runs on the server, which holds them.
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { Server } from "@/core/pocketbase";
import type { Keys } from "@/core/types";

const NAMES = ["server"] as const;
type Name = (typeof NAMES)[number];

// One-shot: the model keys and picks the phone kept while the agent ran on it. Delete once it has run on the phone.
for (const n of ["anthropic", "deepseek", "exa", "agentProvider", "anthropicModel", "deepseekModel"]) SecureStore.deleteItemAsync(n).catch(() => {});

const read = (n: Name) => { try { return SecureStore.getItem(n) ?? undefined; } catch { return undefined; } };   // a Keystore error reads as unset, not a crash at launch
const load = (): Keys => Object.fromEntries(NAMES.map((n) => [n, read(n)]));

export const useKeys = create<{ keys: Keys; set: (n: Name, v: string) => void }>()((set, get) => ({
  keys: load(),
  set: (n, v) => {
    const t = v.trim();
    if (t) SecureStore.setItem(n, t); else SecureStore.deleteItemAsync(n).catch(() => {});
    set({ keys: { ...get().keys, [n]: t || undefined } });
  },
}));

/** The notes server; null when none is set and notes stay on this phone. */
export function serverOf(): Server | null {
  const { server } = useKeys.getState().keys;
  return server ? { url: server } : null;
}
