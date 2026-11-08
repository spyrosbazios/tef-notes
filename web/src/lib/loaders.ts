// What the routes' loaders ask of the query cache (routes/): the router waits for a screen's data, so a screen it has in the cache
// paints whole on the first frame, never a skeleton, and a hover or touch on a link fetches the next one ahead (`preload: "intent"`,
// router.ts). The notes, tasks and links come from the local copy (lib/sync.ts), which answers at once once it has opened, so they
// are awaited; the rest is the server's and only fetched ahead, never awaited: offline, or slow, the screen still opens on what
// the persisted cache holds (lib/persist.ts) and the hooks show the rest as it comes.
import type { QueryClient } from "@tanstack/react-query";
import { lensesQuery } from "@/hooks/lens";
import { linksQuery } from "@/hooks/links";
import { NOTES, notesQuery } from "@/hooks/notes";
import { photoListQuery } from "@/hooks/photos";
import { tagsQuery } from "@/hooks/tags";
import { tasksQuery } from "@/hooks/todo";
import type { NoteRec } from "@/services/notes";

/** The lists every screen of the shell reads: the notes, the tasks and their links (the copy's), the tags and lenses (the server's).
 *  A `preload` (a hover or a touch, asked again every few seconds under a pointer) reads only the copy: the server's lists would
 *  go over the network each time, for a screen that may never open, and the screen asks for them itself. */
export async function loadLists(qc: QueryClient, preload: boolean): Promise<void> {
  if (!preload) {
    void qc.prefetchQuery(tagsQuery);
    void qc.prefetchQuery(lensesQuery);
  }
  await Promise.all([qc.ensureQueryData(notesQuery), qc.ensureQueryData(tasksQuery), qc.ensureQueryData(linksQuery)]);
}

/** A note about to open: its attachments listed ahead when its body shows any, so its pictures start loading with the page. */
export function preloadNote(qc: QueryClient, id: string): void {
  const n = qc.getQueryData<NoteRec[]>(NOTES)?.find((x) => x.note.id === id);
  if (n && /attachments\//.test(n.note.body)) void qc.prefetchQuery(photoListQuery(id));
}
