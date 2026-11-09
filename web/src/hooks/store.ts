// A value this browser keeps in localStorage as JSON, under one of the keys lib/storage-keys.ts lists: read anywhere, set from
// anywhere, and every hook using it follows (a change in another tab too). `parse` turns whatever is stored, or nothing, into the
// value: an unreadable one is none. Storage that refuses (a private window, a full quota) reads as nothing and drops the write.
import { useSyncExternalStore } from "react";
import { STORAGE, STORAGE_PREFIX, type StorageKey } from "@/lib/storage-keys";

export function persisted<T extends object>(key: StorageKey, parse: (stored: Record<string, unknown>) => T) {
  const listeners = new Set<() => void>();
  let cached: { raw: string | null; value: T } | undefined;

  const read = (): T => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { /* refused: nothing */ }
    if (cached?.raw === raw) return cached.value;
    let stored: unknown;
    try { stored = JSON.parse(raw ?? "{}"); } catch { stored = {}; }
    const value = parse(stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {});
    cached = { raw, value };
    return value;
  };
  const write = (value: T) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* refused: the change lasts as long as nothing */ }
    listeners.forEach((l) => l());
  };
  /** Merge `patch` into the value; a key set to undefined is dropped. */
  const set = (patch: Partial<T>) => write({ ...read(), ...patch });
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    addEventListener("storage", cb);
    return () => { listeners.delete(cb); removeEventListener("storage", cb); };
  };
  const use = () => [useSyncExternalStore(subscribe, read), set] as const;
  /** `set` merges; `replace` writes the whole value. */
  return { read, set, replace: write, use, subscribe };
}

/** Removes every `tefnotes.` key lib/storage-keys.ts doesn't list: what a release stopped keeping. Called once, at start (main.tsx). */
export function sweepStorage() {
  try {
    const known = new Set<string>(Object.values(STORAGE));
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_PREFIX) && !known.has(k)) localStorage.removeItem(k);
  } catch { /* refused: nothing to sweep */ }
}
