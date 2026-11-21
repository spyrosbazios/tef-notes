// A change to a client's copy of the notes, tasks and links (sync.ts's rows), as data: what a client's one write entry applies
// (the web's web/src/lib/records.ts). Data rather than a call, so that whatever applies it can be somewhere else than whatever
// decided it (another tab holding the copy, over a channel), and a test can read what was written.
// The decision is made before: a change names its record ids, paths and text in full; applying one makes no choice of its own
// beyond what sync.ts's edit helpers do (a delete of a record the server never had is dropped at once, unless a sync is out).
import type { Mark } from "./record-contracts";
import { linksForNextRound, type Link, type LinkEnd, type LinkRole } from "./record-links";
import { addLink, addNote, removeLink, removeNote, removeTask, saveTask, writeNote, type Store } from "./sync";
import { complete, nextOrder, reopen, type Task } from "./todo";

export type Change =
  /** A note made here, under its own record id. `mark`: its text holds someone else's. */
  | { kind: "note.add"; rec: string; path: string; text: string; mark?: Mark }
  /** A note's whole text. `rec` names the note wherever the copy holds it by the time the change is applied (moved aside to `-2`
   *  by a sync since), and puts it back at `path` when the copy no longer holds it (deleted on another device meanwhile): an edit
   *  made here outlives a delete elsewhere, as the sync's does. */
  | { kind: "note.write"; rec: string; path: string; text: string; mark?: Mark }
  | { kind: "note.remove"; path: string }
  /** A task's fields, a new one's too. */
  | { kind: "task.save"; task: Task }
  | { kind: "task.remove"; id: string }
  /** `from` linked to `to` as `role` under `id` (the relation already held keeps its own). */
  | { kind: "link.add"; id: string; from: LinkEnd; to: LinkEnd; role: LinkRole }
  | { kind: "link.remove"; id: string };

/** Which list of the copy a change is to. */
export type Topic = "notes" | "tasks" | "links";

export const topicOf = (c: Change): Topic => (c.kind.startsWith("note.") ? "notes" : c.kind.startsWith("task.") ? "tasks" : "links");

/** The rows a change names, by table and key (a note's path, a task's or a link's id): what a copy that applied it says it holds
 *  now, to one that applied it on a guess (another tab's, lib/tab-sync.ts). */
export function keysOf(c: Change): [Topic, string] {
  switch (c.kind) {
    case "note.add": case "note.write": case "note.remove": return ["notes", c.path];
    case "task.save": return ["tasks", c.task.id];
    case "task.remove": return ["tasks", c.id];
    case "link.add": case "link.remove": return ["links", c.id];
  }
}

/** `c` applied to the copy. `syncing`: a sync is out (a delete keeps a tombstone then). false when it changed nothing (the text
 *  it held already, a record that isn't there). Throws on a change the copy can't take (a path held, a link refused). */
export function applyChange(s: Store, c: Change, syncing: boolean): boolean {
  switch (c.kind) {
    case "note.add": addNote(s, c.rec, c.path, c.text, c.mark); return true;
    case "note.write": {
      const at = s.notes.get(c.path)?.rec === c.rec ? c.path : s.notes.all().find((n) => n.rec === c.rec)?.path;
      if (at == null) { addNote(s, c.rec, c.path, c.text, c.mark); return true; }
      return writeNote(s, at, c.text, c.mark);
    }
    case "note.remove": return removeNote(s, c.path, syncing);
    case "task.save": {
      const before = s.tasks.get(c.task.id);
      saveTask(s, c.task);
      return s.tasks.get(c.task.id) !== before;
    }
    case "task.remove": {
      const before = s.tasks.get(c.id);
      removeTask(s, c.id, syncing);
      return s.tasks.get(c.id) !== before;
    }
    case "link.add": {
      const before = new Set(s.links.all());               // a put replaces the row: a new or revived one is not among them
      return !before.has(s.links.get(addLink(s, c.id, c.from, c.to, c.role))!);
    }
    case "link.remove": {
      const before = s.links.get(c.id);
      removeLink(s, c.id, syncing);
      return s.links.get(c.id) !== before;
    }
  }
}

/** A task ticked (`done`) or unticked, as changes. A repeating task is done as it is and its next round is a new record
 *  (todo.ts `complete`), last of the open tasks (`open`, the ticked one aside), about what the round done was about: each of its
 *  `links` (those not deleted, sync.ts `liveLinks`) made again from the new round, under a new id. */
export function tickChanges(cur: Task, done: boolean, o: { today: string; newId: () => string; open: Task[]; links: Link[] }): Change[] {
  const r = done ? complete(cur, o.today, o.newId) : { task: reopen(cur), next: undefined };
  const out: Change[] = [{ kind: "task.save", task: r.task }];
  if (!r.next) return out;
  out.push({ kind: "task.save", task: { ...r.next, order: nextOrder(o.open.filter((t) => t.id !== cur.id)) } });
  for (const l of linksForNextRound(o.links, cur.id, r.next.id, o.newId)) out.push({ kind: "link.add", id: l.id, from: l.from, to: l.to, role: l.role });
  return out;
}
