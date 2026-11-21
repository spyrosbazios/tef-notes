// Query projections of the local copy. Task changes also refresh their links; feature hooks
// need not coordinate each other's caches. Query data is derived, never a second writable store.
import type { QueryClient } from "@tanstack/react-query";
import type { Topic } from "@/core/changes";
import { isNotePath, parseNote } from "@/core/notes";
import { visibleLinks, type NoteRow, type TaskRow } from "@/core/sync";
import { taskOf } from "@/core/todo";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";
import { local } from "./local";

export const NOTES = ["notes"] as const;

// ---- the copy, as the cache has it

/** A row's note as the lists read it. Parsed once per version of the row: the list holds the whole notebook and is redrawn
 *  after every save. */
const parsed = new Map<string, { sig: string; rec: NoteRec }>();

export function noteOf(row: NoteRow): NoteRec {
  const sig = `${row.updated}|${row.rev}|${row.rec}|${row.kind}`, hit = parsed.get(row.path);
  if (hit?.sig === sig) return hit.rec;
  const rec: NoteRec = {
    rec: row.rec, path: row.path, rev: row.rev ?? 0, kind: row.kind, text: row.text, updated: new Date(row.updated).toISOString(),
    note: parseNote(row.path, row.text),
  };
  parsed.set(row.path, { sig, rec });
  return rec;
}

/** Every note not deleted here, newest change first. */
export function readNotes(): NoteRec[] {
  const rows = local.notes.all().filter((r) => !r.deleted && isNotePath(r.path));
  const live = new Set(rows.map((r) => r.path));
  for (const p of parsed.keys()) if (!live.has(p)) parsed.delete(p);
  return rows.map(noteOf).sort((a, b) => b.updated.localeCompare(a.updated));
}

export const TASKS = ["tasks"] as const;
export const LINKS = ["links"] as const;

/** A row's task as the lists read it: `rev` 0 for one made here and not up yet. */
export const taskRecOf = (r: TaskRow): TaskRec => ({ ...taskOf(r.data), rev: r.rev ?? 0 });

export function readTasks(): TaskRec[] {
  return local.tasks.all().filter((r) => !r.deleted).map(taskRecOf).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The links to show (core/sync.ts `visibleLinks`). */
export const readLinks = () => visibleLinks(local);

/** The lists `topics` names (every one when none) from the copy. A task change may also hide its links, so a change to the
 *  tasks redraws the links too. The same projection serves writes and syncs (lib/sync-controller.ts `onRedraw`). */
export function projectLocal(qc: QueryClient, topics?: readonly Topic[]): void {
  const all = !topics;
  if (all || topics.includes("notes")) qc.setQueryData(NOTES, readNotes());
  if (all || topics.includes("tasks")) qc.setQueryData(TASKS, readTasks());
  if (all || topics.includes("tasks") || topics.includes("links")) qc.setQueryData(LINKS, readLinks());
}
