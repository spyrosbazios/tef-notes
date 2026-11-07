// The agent's view of the tasks: records of their own, over the clients' own transport (core/pocketbase.ts `tasks`) and
// rules (core/todo.ts). One Todo per request: the
// listing loads once (list_tasks, the checks) and again after a write. Every write is the clients' compare-and-swap:
// it sends the rev it read, and a refusal re-reads and applies the same edit to the fresh record, so a change made
// meanwhile (a tick on the phone) is kept. The edit is a pure function of the record, so a check before the confirm
// card can try it on the record as it is now. A write made with web text in view (`taint`) marks the record `tainted`
// in the same write, as a note's is (notes.ts): reading it back later counts as reading the web. The notes a task is about
// are `links` records (core/record-links.ts), made and removed beside the task's own write: a link has no rev and moves
// neither end's, and both calls are idempotent, so a retry never doubles one.
import { taskCardOf, type TaskCard } from "@/core/agent";
import * as pb from "@/core/pocketbase";
import { addItem, complete, nextOrder, newTask, patchTask, removeItem, reopen, retagTask, setItem, taskOf, type Task, type TaskPatch } from "@/core/todo";
import { localDay } from "@/core/time";
import { linksForNextRound, linksFrom, newLink, notesOfTask, type Link, type LinkEnd } from "@/core/record-links";
import { time } from "./notes";
import type { Stamp } from "./plan";

/** What a write hands back: the kind of record (a task), its id, the rev it is at now, and its card as it now reads (the clients
 *  draw it; none for a delete). `next`: the id of a repeating task's next round. `unchanged`: nothing had to be written. */
export type TodoSaved =
  | { saved: "task"; id: string; rev: number; card?: TaskCard; next?: string; unchanged?: true }
  | { error: string };

/** What addTasks hands back: the ids and cards of the new tasks, in order. */
export type TodoBatch = { saved: "tasks"; ids: string[]; cards: TaskCard[] } | { error: string };

const TRIES = 3, PAGE = 500;

export type Edit<T> = (cur: T) => T;

/** What an item of a task's checklist is told by: ids from list_tasks. */
export type ChecklistOps = {
  add?: string[]; set?: { id: string; text?: string; done?: boolean }[]; remove?: string[];
};

/** `t` with the checklist ops applied: removed, then changed, then added at the end. An id no item has throws. */
export function checklistEdit(t: Task, ops: ChecklistOps): Task {
  let n = t;
  for (const id of [...(ops.remove ?? []), ...(ops.set ?? []).map((s) => s.id)])
    if (!n.checklist.some((i) => i.id === id)) throw new Error(`No checklist item ${id} in “${t.title}”. list_tasks has the ids.`);
  for (const id of ops.remove ?? []) n = removeItem(n, id);
  for (const { id, ...p } of ops.set ?? []) n = setItem(n, id, p);
  for (const text of ops.add ?? []) n = addItem(n, text);
  return n;
}

const taskEnd = (id: string): LinkEnd => ({ type: "task", id });

export class Todo {
  private rows?: Promise<Task[]>;
  private linkRows?: Promise<Link[]>;
  private times?: Promise<Map<string, Stamp>>;
  constructor(readonly server: pb.Server) {}

  private reload() { this.rows = undefined; this.linkRows = undefined; this.times = undefined; }

  /** Every link (list_tasks reads a task's notes from them). */
  links() { return (this.linkRows ??= pb.links.list(this.server)); }
  /** The record ids of the notes a task is about. */
  async notesOf(id: string) { return notesOfTask(await this.links(), id); }

  tasks() { return (this.rows ??= pb.tasks.list(this.server)); }
  /** Every task's `created` and `updated` on the server, by id: columns of the server's own, which the core's Task leaves out
   *  (the review reads how long a task has gone unchanged). */
  stamps() {
    return (this.times ??= (async () => {
      const out = new Map<string, Stamp>();
      for (let page = 1; ; page++) {
        const j = await pb.call(this.server, `collections/tasks/records?fields=id,created,updated&perPage=${PAGE}&page=${page}&skipTotal=1`);
        for (const r of j.items) out.set(r.id, { created: time(r.created), updated: time(r.updated) });
        if (j.items.length < PAGE) return out;
      }
    })());
  }
  async task(id: string) { return (await this.tasks()).find((t) => t.id === id); }

  /** The card of a task as it is now; undefined when there is none. */
  async taskCard(id: string): Promise<TaskCard | undefined> {
    const t = await this.task(id);
    return t && taskCardOf(t);
  }

  private async cardOf(id: string) {
    const card = await this.taskCard(id);
    this.reload();                      // the listing was only for the card: the next read sees what has changed since
    return card ? { card } : {};
  }

  /** The ids of the tasks written with web text in view. */
  async tainted(): Promise<Set<string>> {
    return new Set((await pb.tasks.list(this.server, { filter: "tainted = true" })).map((r) => r.id));
  }

  /** `edit(the record as it is now)` written over the rev it was read at; a refusal re-reads and redoes it. `edit`
   *  throwing is the format refusing it (a day that isn't one): the message comes back as the result. The same record
   *  back means there is nothing to write. */
  private async change(id: string, edit: Edit<Task>, taint: boolean): Promise<TodoSaved> {
    for (let i = 0; i < TRIES; i++) {
      const cur = await pb.tasks.get(this.server, id);
      if (!cur) { this.reload(); return { error: `No task ${id}: it was deleted meanwhile.` }; }
      const was = taskOf(cur);
      let next: Task;
      try { next = edit(was); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      if (next === was) return { saved: "task", id, rev: cur.rev, ...(await this.cardOf(id)), unchanged: true };
      try {
        const fields: Task & { tainted?: true } = taint ? { ...next, tainted: true } : next;
        const r = await pb.tasks.update(this.server, id, cur.rev, fields);
        this.reload();
        return r ? { saved: "task", id, rev: r.rev, ...(await this.cardOf(id)) } : { error: `No task ${id}: it was deleted meanwhile.` };
      } catch (e) {
        if (!(e instanceof pb.Conflict)) throw e;
      }
    }
    return { error: "The task keeps changing under this edit; try again in a moment." };
  }

  /** A new record under an id of its own (a taken one: the next); its id and the rev it is at. */
  private async insert(make: (id: string) => Task, taint: boolean): Promise<{ id: string; rev: number } | { error: string }> {
    for (let i = 0; i < TRIES; i++) {
      let r: Task & { tainted?: true };
      try { r = make(pb.recordId()); if (taint) r = { ...r, tainted: true }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      try {
        const saved = await pb.tasks.create(this.server, r);
        return { id: saved.id, rev: saved.rev };
      } catch (e) {
        if (!(e instanceof pb.Conflict)) throw e;
      }
    }
    return { error: "Couldn't name the new task; try again." };
  }

  /** A new record, with its card. */
  private async create(make: (id: string) => Task, taint: boolean): Promise<TodoSaved> {
    const r = await this.insert(make, taint);
    if ("error" in r) return r;
    this.reload();
    return { saved: "task", id: r.id, rev: r.rev, ...(await this.cardOf(r.id)) };
  }

  /** The task `id` linked to (`about`) each note of `link` (record ids; one it is linked to already stays as it is), and
   *  unlinked from each of `unlink`. Null when done, or what failed (a note deleted meanwhile). */
  private async relink(id: string, link: string[], unlink: string[]): Promise<string | null> {
    try {
      const had = linksFrom(await this.links(), taskEnd(id), "about");
      for (const rec of link) await pb.links.add(this.server, newLink(pb.recordId(), taskEnd(id), { type: "note", id: rec }, "about"));
      for (const l of had) if (l.to.type === "note" && unlink.includes(l.to.id)) await pb.links.remove(this.server, l.id);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      this.linkRows = undefined;
    }
  }

  /** A new open task after the last one, linked to the notes `about` (record ids). */
  async addTask(fields: TaskPatch & { title: string }, checklist: string[] = [], taint = false, about: string[] = []): Promise<TodoSaved> {
    const order = nextOrder(await this.tasks());
    const r = await this.create((id) => checklistEdit(newTask(id, { ...fields, order }), { add: checklist }), taint);
    if ("error" in r || !about.length) return r;
    const why = await this.relink(r.id, about, []);
    return why ? { error: `Added the task (${r.id}), but it wasn't linked to its note: ${why}` } : r;
  }

  /** Several new open tasks after the last one, in the order given, each a record of its own (created one by one: a
   *  failure part way leaves the earlier ones, and the error says which). */
  async addTasks(items: { fields: TaskPatch & { title: string }; checklist: string[] }[], taint = false): Promise<TodoBatch> {
    const first = nextOrder(await this.tasks());
    const ids: string[] = [];
    for (const [n, { fields, checklist }] of items.entries()) {
      const r = await this.insert((id) => checklistEdit(newTask(id, { ...fields, order: first + n }), { add: checklist }), taint);
      if ("error" in r) {
        this.reload();
        return { error: `Added ${ids.length} of ${items.length} tasks, then “${fields.title}” failed: ${r.error}${ids.length ? ` Added: ${ids.join(", ")}.` : ""}` };
      }
      ids.push(r.id);
    }
    this.reload();
    const cards = (await Promise.all(ids.map((id) => this.taskCard(id)))).filter((c): c is TaskCard => !!c);
    this.reload();
    return { saved: "tasks", ids, cards };
  }

  /** The task changed by `edit`, then linked to the notes of `link` and unlinked from those of `unlink` (record ids). */
  async editTask(id: string, edit: Edit<Task>, taint = false, link: string[] = [], unlink: string[] = []): Promise<TodoSaved> {
    const r = await this.change(id, edit, taint);
    if ("error" in r || (!link.length && !unlink.length)) return r;
    const why = await this.relink(id, link, unlink);
    if (why) return { error: `${r.unchanged ? "The task's" : "Changed the task, but its"} notes weren't relinked: ${why}` };
    const { unchanged: _, ...written } = r;
    return written;
  }

  /** Tick or untick. A repeating task is done as it is and its next round made as a record of its own, after the
   *  tick has landed (so a retried tick never makes two). */
  async completeTask(id: string, done: boolean, taint = false): Promise<TodoSaved> {
    let next: Task | undefined;
    const r = await this.change(id, (t) => {
      next = undefined;
      if (!done) return t.done ? reopen(t) : t;
      const c = complete(t, localDay(), pb.recordId);
      next = c.next;
      return c.task;
    }, taint);
    if (!next || "error" in r) return r;
    const made = await this.create((nid) => ({ ...next!, id: nid }), taint);
    if ("error" in made) return { error: `Ticked, but its next round wasn't made: ${made.error}` };
    try {
      for (const l of linksForNextRound(await this.links(), id, made.id, pb.recordId)) await pb.links.add(this.server, l);
    } catch (e) {
      return { error: `Ticked, and its next round made (${made.id}), but not linked to its notes: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      this.linkRows = undefined;
    }
    return { ...r, next: made.id };
  }

  /** Gone, unless it moved on since it was read (then the delete is tried again on the new rev: it is the same wish). */
  async deleteTask(id: string): Promise<TodoSaved> {
    for (let i = 0; i < TRIES; i++) {
      const cur = await pb.tasks.get(this.server, id);
      if (!cur) { this.reload(); return { error: `No task ${id}.` }; }
      try {
        await pb.tasks.remove(this.server, id, cur.rev);
        this.reload();
        return { saved: "task", id, rev: cur.rev };
      } catch (e) {
        if (!(e instanceof pb.Conflict)) throw e;
      }
    }
    return { error: "The task keeps changing; try again in a moment." };
  }
}

/** Tags to put on a task and to take off it (by name, ignoring case). */
export type TagOps = { add: string[]; remove: string[] };

/** The edit a task patch is, on the record: patchTask, then the checklist ops, then the tags put on and taken off. */
export const taskEdit = (patch: TaskPatch, ops: ChecklistOps = {}, tags: TagOps = { add: [], remove: [] }): Edit<Task> =>
  (t) => retagTask(checklistEdit(patchTask(t, patch), ops), tags.add, tags.remove);
