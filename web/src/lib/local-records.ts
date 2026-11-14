// Query projections of the local copy. Task changes also refresh their links; feature hooks
// need not coordinate each other's caches. Query data is derived, never a second writable store.
import type { QueryClient } from "@tanstack/react-query";
import { isNotePath, parseNote } from "@/core/notes";
import { visibleLinks, type NoteRow } from "@/core/sync";
import { taskOf } from "@/core/todo";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";
import { local } from "./local";
import { edited } from "./sync";

export const NOTES = ["notes"] as const;

// ---- the copy, as the cache has it

/** A row's note as the lists read it. Parsed once per version of the row: the list holds the whole notebook and is redrawn
 *  after every save. */
const parsed = new Map<string, { sig: string; rec: NoteRec }>();

export function noteOf(row: NoteRow): NoteRec {
  const sig = `${row.updated}|${row.rev}|${row.rec}|${row.kind}`, hit = parsed.get(row.path);
  if (hit?.sig === sig) return hit.rec;
  const rec: NoteRec = {
    rec: row.rec ?? "", path: row.path, rev: row.rev ?? 0, kind: row.kind, text: row.text, updated: new Date(row.updated).toISOString(),
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

export function taskRec(id: string): TaskRec {
  const r = local.tasks.get(id)!;
  return { ...taskOf(r.data), rev: r.rev ?? 0 };
}

export function readTasks(): TaskRec[] {
  return local.tasks.all().filter((r) => !r.deleted).map((r) => taskRec(r.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** A task change may also delete or carry its links. The same projection serves local edits and sync. */
export function projectLocal(qc: QueryClient, topic?: "notes" | "tasks" | "links"): void {
  if (!topic || topic === "notes") qc.setQueryData(NOTES, readNotes());
  if (!topic || topic === "tasks") qc.setQueryData(TASKS, readTasks());
  if (topic !== "notes") qc.setQueryData(LINKS, visibleLinks(local));
}

export function localEdited(qc: QueryClient, topic: "notes" | "tasks" | "links"): void {
  projectLocal(qc, topic);
  edited();
}
