// Every key the app keeps in this browser's localStorage. A choice the owner makes is a preference, kept on the server
// (core/prefs.ts says which is which); this browser keeps only its copy of those and the state of its own windows. `persisted`
// (hooks/store.ts) takes no key but these, and on start removes any other `tefnotes.` key (one a release stopped using).
// No imports: the build reads this file in Node (vite-boot.ts).
export const STORAGE = {
  /** The preferences' copy (hooks/prefs.ts); the boot script reads its `theme` and `accent` before any other script runs. */
  prefs: "tefnotes.prefs",
  /** The assistant's dock: open or not, how wide, the chat it is on (hooks/dock.ts). */
  dock: "tefnotes.dock",
  /** When the dock was last on screen, for the new-chat rule (assistant/provider.tsx). */
  chatSeen: "tefnotes.chat-seen",
} as const;

export type StorageKey = (typeof STORAGE)[keyof typeof STORAGE];

/** What every key starts with. */
export const STORAGE_PREFIX = "tefnotes.";
