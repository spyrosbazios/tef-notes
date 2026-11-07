// Tag definitions (name, badge colour, a hint for the AI) as the server has them, kept on the phone so badges
// are coloured offline too. A note's own tags are in its
// file (core/notes.ts); this is only what they are painted with. Failures are silent: the cached list stays.
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTag, listTags, removeTag, updateTag, type TagDef, type TagFields } from "@/core/tags";
import { serverOf, useKeys } from "./keys";
import { mmkvStorage } from "./storage";

type S = {
  defs: TagDef[];                    // by name, as the server listed them
};

export const useTags = create<S>()(
  persist(
    (): S => ({ defs: [] }),
    { name: "tags", storage: createJSONStorage(() => mmkvStorage("tags").storage), partialize: ({ defs }) => ({ defs }) },
  ),
);

/** The server's definitions into the store. Offline or failing: what is cached stays. */
export async function refreshTags(): Promise<void> {
  const s = serverOf();
  if (!s) return;
  try { useTags.setState({ defs: await listTags(s) }); } catch { /* the cached list stays */ }
}

/** A definition made, changed (`rec`) or removed (`fields` left out) on the server, then re-read. Throws what the server
 *  said: Conflict when the name is taken, so the form can show it. */
export async function saveTag(rec: string | null, fields: TagFields): Promise<void> {
  const s = serverOf();
  if (!s) throw new Error("No server set");
  if (rec) await updateTag(s, rec, fields); else await createTag(s, fields);
  await refreshTags();
}

export async function deleteTag(rec: string): Promise<void> {
  const s = serverOf();
  if (!s) throw new Error("No server set");
  await removeTag(s, rec);
  await refreshTags();
}

/** Definitions are read on launch, on coming to the front (the laptop may have changed them) and when the server is set. */
export function useTagSync() {
  const server = useKeys((s) => s.keys.server);
  useEffect(() => {
    refreshTags();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") refreshTags(); });
    return () => sub.remove();
  }, [server]);
}
