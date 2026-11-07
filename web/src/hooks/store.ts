// A browser setting kept in localStorage as JSON: read anywhere, set from anywhere, and every hook using it follows (a
// change in another tab too). `parse` turns whatever is stored, or nothing, into the setting: an unreadable value is no value.
import { useSyncExternalStore } from "react";

export function persisted<T extends object>(key: string, parse: (stored: Record<string, unknown>) => T) {
  const listeners = new Set<() => void>();
  let cached: { raw: string | null; value: T } | undefined;

  const read = (): T => {
    const raw = localStorage.getItem(key);
    if (cached?.raw === raw) return cached.value;
    let stored: unknown;
    try { stored = JSON.parse(raw ?? "{}"); } catch { stored = {}; }
    const value = parse(stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {});
    cached = { raw, value };
    return value;
  };
  /** Merge `patch` into the setting; a key set to undefined is dropped. */
  const set = (patch: Partial<T>) => {
    localStorage.setItem(key, JSON.stringify({ ...read(), ...patch }));
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    addEventListener("storage", cb);
    return () => { listeners.delete(cb); removeEventListener("storage", cb); };
  };
  const use = () => [useSyncExternalStore(subscribe, read), set] as const;
  return { read, set, use, subscribe };
}
