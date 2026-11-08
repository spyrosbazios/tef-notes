// The offline copy this browser keeps, and what Settings does with it: the local copy of the notes, tasks and links with the edits
// not yet sent (lib/local.ts), the query cache in IndexedDB (lib/persist.ts decides what goes in it) and the attachment files the
// service worker keeps (sw/sw.ts). The persister is made here so root.tsx
// (which mounts it) and Settings (which clears it) share the one.
import { createStore, del, get, set } from "idb-keyval";
import { clearLocal } from "./local";
import { throttled } from "./persist";
import { getStatus } from "./sync";

export const persister = throttled({ get, set, del }, "query-cache", 1000, createStore("tefnotes", "query"));

/** The service worker's cache of attachment files (sw/sw.ts names it the same). */
const FILES = "attachment-files";

/** How many attachment files (pictures, thumbnails, PDFs) are kept for offline. */
export async function keptFiles(): Promise<number> {
  if (!("caches" in globalThis) || !(await caches.has(FILES))) return 0;
  return (await (await caches.open(FILES)).keys()).length;
}

/** Forget the offline copy: the local copy, the stored query cache and the kept files. The page then reloads, so nothing still in
 *  memory writes it back; what the server has comes down again on the next visit online. What was never sent would be lost with
 *  it, so nothing is forgotten while any change waits. */
export async function clearOffline(): Promise<void> {
  if (getStatus().waiting) throw new Error("Changes made here haven't reached the server yet.");
  persister.disable();   // the cache changing during the awaits below, and the flush as the page hides, would write it back
  await clearLocal();
  await persister.removeClient();
  if ("caches" in globalThis) await caches.delete(FILES);
  location.reload();
}
