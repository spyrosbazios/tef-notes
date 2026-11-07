// MMKV files: prefs, the cache, and, each in its own so a cache wipe never takes them along, tag definitions and link
// previews. The server's address lives in SecureStore instead (src/store/keys.ts); chats on the server (src/store/chats.ts).
import { createMMKV } from "react-native-mmkv";
import type { StateStorage } from "zustand/middleware";

/** An MMKV file and the zustand `persist` adapter over it. */
export function mmkvStorage(id: string) {
  const mmkv = createMMKV({ id });
  const storage: StateStorage = {
    getItem: (k) => mmkv.getString(k) ?? null,
    setItem: (k, v) => mmkv.set(k, v),
    removeItem: (k) => mmkv.remove(k),
  };
  return { mmkv, storage };
}

export const cache = createMMKV({ id: "cache" });
/** What the server said about each URL a note links to (src/store/previews.ts): rebuildable, so its own file to wipe alone. */
export const previewFile = createMMKV({ id: "previews" });
export const zustandPrefs = mmkvStorage("prefs").storage;
