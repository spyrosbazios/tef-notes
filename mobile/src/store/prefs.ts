// Device prefs that aren't secret and never sync: the prefs MMKV file (src/store/storage.ts).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { NoteSort } from "@/core/note-sort";
import { DEFAULT_ACCENT, DEFAULT_THEME, type AccentName, type ThemeName } from "@/core/theme";
import { zustandPrefs } from "./storage";

export type Prefs = {
  photosWifiOnly: boolean;            // attachments wait for Wi-Fi; notes still sync on mobile data
  agentWritesWithoutAsking: boolean;  // sent with each message: note writes skip the confirm card (the server still asks after web reads)
  agentModelId: string | null;        // the model this phone's messages go to; null: the server's default (pickModel)
  theme: ThemeName;                   // the palette (packages/core/src/theme.ts), applied by src/ui/use-theme.ts
  accent: AccentName;                 // the primary colour over it; "theme": the theme's own
  clipSummary: boolean;               // the Share screen's "Add a summary" box, as it was left
  notesView: "list" | "tags";         // Notes as one list of tiles, or grouped under a header per tag
  notesTags: string[];                // Home's notes tag filter: none all, NO_TAG the untagged, else the tags to show (any of them)
  collapsedTags: string[];            // the grouped view's folded groups (tag names, NO_TAG for "No tag")
  notesSort: NoteSort;                // Home's note order (@/core/note-sort), as it was left
  lensRec: string | null;             // the lens this phone has on (a `lenses` record id, core/lens.ts); null: none. A stale id reads as none
};

export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void }>()(
  persist(
    (set) => ({ photosWifiOnly: false, agentWritesWithoutAsking: false, agentModelId: null, theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, clipSummary: false, notesView: "list", notesTags: [], collapsedTags: [], notesSort: "updated", lensRec: null, set: (p) => set(p) }),
    {
      name: "prefs", storage: createJSONStorage(() => zustandPrefs),
      partialize: ({ photosWifiOnly, agentWritesWithoutAsking, agentModelId, theme, accent, clipSummary, notesView, notesTags, collapsedTags, notesSort, lensRec }) =>
        ({ photosWifiOnly, agentWritesWithoutAsking, agentModelId, theme, accent, clipSummary, notesView, notesTags, collapsedTags, notesSort, lensRec }),
    },
  ),
);
