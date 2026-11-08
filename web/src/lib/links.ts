// What the web app asks of the links (core/record-links.ts), pure: the notes a task is about as the cache has them, the tasks
// that link to a note, and the task list a task opens in.
import { backlinks, linksFrom, notesOfTask, type Link } from "@/core/record-links";
import type { Task } from "@/core/todo";
import type { NoteRec } from "@/services/notes";
import type { View } from "./nav";

/** The notes a task is about, in link order, each with the link that names it; `unseen` counts those the cache has no note
 *  for yet (made on another device a moment ago). */
export function notesFor(links: readonly Link[], taskId: string, notes: readonly NoteRec[]): { linked: { link: Link; n: NoteRec }[]; unseen: number } {
  const byRec = new Map(notes.map((n) => [n.rec, n]));
  const mine = linksFrom(links, { type: "task", id: taskId }, "about").filter((l) => l.to.type === "note");
  const linked: { link: Link; n: NoteRec }[] = [];
  let unseen = 0;
  for (const link of mine) { const n = byRec.get(link.to.id); if (n) linked.push({ link, n }); else unseen++; }
  return { linked, unseen };
}

/** The tasks linking to a note (any role), each once, in link order; tasks the cache doesn't have are left out. */
export function tasksFor<T extends Pick<Task, "id">>(links: readonly Link[], noteRec: string, tasks: readonly T[]): T[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: T[] = [], seen = new Set<string>();
  for (const l of backlinks(links, noteRec)) {
    const t = l.from.type === "task" ? byId.get(l.from.id) : undefined;
    if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
  }
  return out;
}

/** What a task row says of its notes: the first one's title, and how many more. null when it is about none the cache has. */
export function noteSummary(links: readonly Link[], taskId: string, titles: ReadonlyMap<string, string>): { title: string; more: number } | null {
  const known = notesOfTask(links, taskId).filter((id) => titles.has(id));
  return known.length ? { title: titles.get(known[0])!, more: known.length - 1 } : null;
}

/** The record ids of the notes a task is about already: what the picker leaves out. */
export const linkedNoteIds = (links: readonly Link[], taskId: string) => new Set(notesOfTask(links, taskId));

/** The task list a task opens in, beside it: the Logbook once done, else the list Things puts it in. */
export function taskView(t: Pick<Task, "done" | "when">, today: string): View {
  if (t.done) return { kind: "logbook" };
  if (t.when) return { kind: t.when <= today ? "today" : "upcoming" };
  return { kind: "inbox" };
}
