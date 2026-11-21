// The notes, tasks and links as the app writes them: the one module that edits the local copy (lib/local.ts), over the sync
// controller (lib/sync-controller.ts). Every write is a change (core/changes.ts) handed to the controller's `apply`, which
// applies it, counts it, sends it a moment later and redraws the lists it touched; nothing else calls the core's edit helpers
// or holds the copy. Hooks expose these (hooks/notes.ts, todo.ts, links.ts, draft.ts, sync.ts); components reach them through
// the hooks (scripts/check-boundaries.ts keeps it so).
// Because a write is data handed to one entry, the copy can be another tab's: only the tab that leads syncs, and the others'
// `apply` hands it their changes (lib/tab-sync.ts), without a hook knowing which tab it is in.
//
// An open note's typing is a draft (lib/drafts.ts) this module owns, by the note's record id: it outlives the editor (a note
// moved aside to `-2` on its first push keeps its record id, and its draft), every sync puts what is pending into the copy
// before it pulls (`beforeRound`), so a pull sees the note edited here, and a draft whose note was deleted on another device
// meanwhile puts it back under its record id with the text typed (core/changes.ts `note.write`), as any edit made here outlives a
// delete elsewhere (core/sync.ts).
// Nothing typed is dropped but by the owner deleting the note here.
import { tickChanges, type Change } from "@/core/changes";
import { NOTES as NOTE_DIR, newNotePath, noteIdOf, parseNote, serializeNote, withBody, withFlags, type FlagEdit } from "@/core/notes";
import { recordId } from "@/core/pocketbase";
import type { Mark } from "@/core/record-contracts";
import { newLink, sameLink, type Link, type LinkEnd, type LinkRole } from "@/core/record-links";
import { liveLinks, type NoteRow, type Refusal, type Store } from "@/core/sync";
import { localDay } from "@/core/time";
import { newTask, nextOrder, patchTask, taskOf, type Task, type TaskPatch } from "@/core/todo";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";
import * as notesService from "@/services/notes";
import { createDraft, LINES, MINE, type Draft, type DraftField } from "./drafts";
import { flushLocal, local } from "./local";
import { noteOf, taskRecOf } from "./local-records";
import { getNet, isOffline } from "./net";
import { startSync, sync } from "./sync";
import type { Settle, SyncController } from "./sync-controller";

/** The note was deleted elsewhere while it was being changed here. */
export class Gone extends Error {}

/** How long a note's typing waits after the last key before it goes into the copy. */
const NOTE_DELAY = 800;

/** An open note's two drafts. */
export type NoteDrafts = { body: Draft; title: Draft };

type Controller = Pick<SyncController, "apply" | "movedTo" | "syncNow" | "pushNow" | "settle" | "resolveRefused" | "beforeRound">;

/** The records over one copy and its controller. `serverHas`: whether the server holds a note at a path (false when it can't
 *  be asked): a new note's name steps past one it has. */
export function createRecords({ store, sync, serverHas }: { store: Store; sync: Controller; serverHas: (path: string) => Promise<boolean> }) {
  // ---- notes

  const byRec = (rec: string) => store.notes.all().find((n) => n.rec === rec);

  /** The note `r` names, where it is now: by its record id, which a move aside keeps, else at its path or where that moved to
   *  (another record made at the path elsewhere since). Undefined when it is gone, or deleted here. */
  function noteNow(r: { rec: string; path: string }): NoteRow | undefined {
    const n = byRec(r.rec);
    if (n) return n.deleted ? undefined : n;
    const at = store.notes.get(sync.movedTo(r.path));
    return at && !at.deleted ? at : undefined;
  }

  /** `edit` applied to the note's text as the copy has it now (the sync may have merged another device's edit in since the
   *  caller last looked) and written there, to go up on the next sync; with `mark` when the edit put in someone else's words.
   *  `edit` throws to stop. */
  async function write(r: { rec: string; path: string }, edit: (text: string, path: string) => string, mark: Mark = {}): Promise<NoteRec> {
    const row = noteNow(r);
    if (!row) throw new Gone("This note was deleted on another device.");
    sync.apply([{ kind: "note.write", rec: row.rec, path: row.path, text: edit(row.text, row.path), mark }]);
    return noteOf(store.notes.get(row.path)!);
  }

  const setFlags = (r: { rec: string; path: string }, flags: FlagEdit) => write(r, (text, path) => withFlags(path, text, flags));

  /** A new note, its path made from the title; `-2`, `-3` when this copy or, while the server answers, the server has the name. */
  async function createNote(title: string, body = "", tags: string[] = []): Promise<NoteRec> {
    const taken = new Set(store.notes.all().map((n) => n.path));
    for (;;) {
      const path = newNotePath(title, Date.now(), taken);
      if (await serverHas(path) || store.notes.get(path)) { taken.add(path); continue; }   // (or made here while the server was asked)
      sync.apply([{ kind: "note.add", rec: recordId(), path, text: serializeNote({ title: title.trim(), created: localDay(), tags }, body) }]);
      return noteOf(store.notes.get(path)!);
    }
  }

  /** Where the note at `path` is on the server, sent there first when it has never been: what anything filed under a note's id
   *  (its photos, PDFs and drawings) waits for. A note made here may still move aside to `-2` on its first push (another device
   *  had the name); once on the server its path never changes, so a file put under it there stays with it. Throws when it
   *  couldn't go up (offline, refused). */
  async function landed(path: string): Promise<string> {
    const row = store.notes.get(sync.movedTo(path));
    if (row && !row.deleted && row.rev != null) return row.path;
    await sync.pushNow();
    const now = store.notes.get(sync.movedTo(path));
    if (!now || now.deleted) throw new Gone("This note was deleted.");
    if (now.rev == null) throw new Error(now.refused ? `The server refused this note: ${now.refused}` : "This note isn't on the server yet, so files can't be added to it. Try again when it's reachable.");
    return now.path;
  }

  /** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back with their edit).
   *  What was typed into it and not yet saved goes with it. */
  async function deleteNote(r: { rec: string; path: string }): Promise<void> {
    const d = drafts.get(r.rec);
    d?.body.drop(); d?.title.drop();
    const row = noteNow(r);
    if (row) sync.apply([{ kind: "note.remove", path: row.path }]);
  }

  /** The id of the note opened as `id`, wherever it is now: a note made here that moved aside to `-2` on its first push has
   *  another (`movedTo`). */
  const noteIdNow = (id: string) => noteIdOf(sync.movedTo(`${NOTE_DIR}${id}.md`));

  // ---- an open note's drafts

  /** By record id: the drafts, and how many editors hold them. */
  const drafts = new Map<string, NoteDrafts>(), users = new Map<string, number>();

  /** The text with `typed` as its body, or as its title (an emptied title keeps the old one). */
  function typedInto(path: string, text: string, part: "body" | "title", typed: string): string {
    const n = parseNote(path, text);
    return part === "body" ? withBody(text, n, typed) : withBody(text, n, n.body, typed.trim() || undefined);
  }

  function makeDrafts(rec: string, path: string): NoteDrafts {
    let seen = { rec, path, text: store.notes.get(path)?.text ?? "" };   // where the note was last found, and its text there
    const row = () => {
      const n = noteNow(seen);
      if (n) seen = { rec: n.rec, path: n.path, text: n.text };
      return n;
    };
    const field = (part: "body" | "title"): DraftField => ({
      read: () => { const n = row(); return n ? parseNote(n.path, n.text)[part] : undefined; },
      write: (typed, mark) => {
        const n = row();
        if (!n && byRec(seen.rec)?.deleted) return;            // deleted here, by the owner
        // Gone from the copy (deleted on another device while this was typed), the typed text puts it back under its record id
        const at = n ?? seen;
        sync.apply([{ kind: "note.write", rec: at.rec, path: at.path, text: typedInto(at.path, at.text, part, typed), mark }]);
        row();
      },
    });
    return {
      body: createDraft({ field: field("body"), merge: LINES, delay: NOTE_DELAY }),
      title: createDraft({ field: field("title"), merge: MINE, delay: NOTE_DELAY }),
    };
  }

  /** The drafts of the note `r` (its record id's), made when there are none. */
  function noteDrafts(r: { rec: string; path: string }): NoteDrafts {
    let d = drafts.get(r.rec);
    if (!d) drafts.set(r.rec, (d = makeDrafts(r.rec, r.path)));
    return d;
  }

  /** An editor holds the note's drafts `d` (noteDrafts'); the returned release sends what is pending, and lets them go once
   *  nothing holds them and nothing waits in them. Held again after that, they are the note's again. */
  function holdDrafts(rec: string, d: NoteDrafts): () => Promise<void> {
    if (!drafts.has(rec)) drafts.set(rec, d);
    users.set(rec, (users.get(rec) ?? 0) + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      users.set(rec, users.get(rec)! - 1);
      await Promise.all([d.body.flush(), d.title.flush()]);
      if (!users.get(rec) && !d.body.pending() && !d.title.pending() && drafts.get(rec) === d) { drafts.delete(rec); users.delete(rec); }
    };
  }

  /** Every open note's pending typing into the copy now. */
  const flushDrafts = () => Promise.all([...drafts.values()].flatMap((d) => [d.body.flush(), d.title.flush()])).then(() => undefined);
  /** Whether any open note has typing not yet in the copy. */
  const draftsPending = () => [...drafts.values()].some((d) => d.body.pending() || d.title.pending());
  sync.beforeRound(flushDrafts);

  // ---- tasks

  const GONE = "This was deleted on another device.";

  /** The task as the copy holds it; throws when it is gone (the sync took the server's delete). */
  function held(id: string): Task {
    const r = store.tasks.get(id);
    if (!r || r.deleted) throw new Error(GONE);
    return taskOf(r.data);
  }
  const open = () => store.tasks.all().filter((r) => !r.deleted && !r.data.done).map((r) => r.data);
  const taskNow = (id: string) => taskRecOf(store.tasks.get(id)!);

  /** A new open task at the end of the open ones. Throws on a value the server would refuse. */
  async function addTask(fields: TaskPatch & { title: string }): Promise<TaskRec> {
    const t = newTask(recordId(), { order: nextOrder(open()), ...fields });
    sync.apply([{ kind: "task.save", task: t }]);
    return taskNow(t.id);
  }

  /** `edit` applied to the task as the copy holds it, and written there. `edit` throws to stop (a value the server would refuse). */
  async function changeTask(id: string, edit: (t: Task) => Task): Promise<TaskRec> {
    sync.apply([{ kind: "task.save", task: edit(held(id)) }]);
    return taskNow(id);
  }

  const editTask = (id: string, patch: TaskPatch) => changeTask(id, (t) => patchTask(t, patch));

  /** Gone from the lists now, from the server on the next sync, if nobody changed it since (else it comes back). Its links go with it. */
  async function removeTask(id: string): Promise<void> {
    sync.apply([{ kind: "task.remove", id }]);
  }

  /** Tick or untick (core/changes.ts `tickChanges`: a repeating task's next round, about what the round done was about). */
  async function tickTask(id: string, done: boolean): Promise<void> {
    sync.apply(tickChanges(held(id), done, { today: localDay(), newId: recordId, open: open(), links: liveLinks(store) }));
  }

  // ---- links

  /** `from` linked to `to` as `role`, under a new id (the link already there, when this relation is); the sync sends it. */
  async function addLink(from: LinkEnd, to: LinkEnd, role: LinkRole): Promise<Link> {
    const want = newLink(recordId(), from, to, role);
    sync.apply([{ kind: "link.add", id: want.id, from, to, role } satisfies Change]);
    return store.links.all().find((r) => !r.deleted && sameLink(r.link, want))!.link;
  }

  /** A link gone (already gone is done). */
  async function removeLink(id: string): Promise<void> {
    sync.apply([{ kind: "link.remove", id }]);
  }

  return {
    write, setFlags, createNote, landed, deleteNote, noteIdNow,
    /** A note's row as the copy holds it now (what Settings shows of a conflict). */
    noteRow: (path: string): NoteRow | undefined => store.notes.get(path),
    settle: (path: string, how: Settle) => sync.settle(path, how),
    resolveRefused: (r: Pick<Refusal, "kind" | "key">, how: "retry" | "discard") => sync.resolveRefused(r, how),
    noteDrafts, holdDrafts, flushDrafts, draftsPending,
    addTask, changeTask, editTask, removeTask, tickTask,
    addLink, removeLink,
  };
}

/** Whether the server has a note at `path` already; false when it can't be asked (offline, slow): the sync moves a clash aside. */
async function onServer(path: string): Promise<boolean> {
  if (isOffline(getNet())) return false;
  try { return !!(await notesService.read(path, 3000)); } catch { return false; }
}

// ---- this browser's

export const records = createRecords({ store: local, sync, serverHas: onServer });

export const {
  write, setFlags, createNote, landed, deleteNote, noteIdNow, noteRow, settle, resolveRefused,
  noteDrafts, holdDrafts, addTask, changeTask, editTask, removeTask, tickTask, addLink, removeLink,
} = records;

/** Mounted by the app's live-data hook (hooks/live.ts): the sync's triggers, and an open note's typing put into the copy before
 *  the page goes (asked first, ahead of the copy's own write to IndexedDB on the same events) and the page held while it waits. */
export function startRecords(): () => void {
  const hidden = () => { if (document.visibilityState === "hidden") void records.flushDrafts(); };
  const leaving = () => { void records.flushDrafts(); };
  const warn = (e: BeforeUnloadEvent) => { if (records.draftsPending()) { void records.flushDrafts(); e.preventDefault(); } };
  document.addEventListener("visibilitychange", hidden);
  addEventListener("pagehide", leaving);
  addEventListener("beforeunload", warn);
  const stop = startSync();
  return () => {
    document.removeEventListener("visibilitychange", hidden);
    removeEventListener("pagehide", leaving);
    removeEventListener("beforeunload", warn);
    stop();
  };
}

// What hooks read beside the writes: the copy's lists, the sync's status and triggers. Hooks import them from here, never
// lib/local or lib/sync.
export { flushLocal };
export { LOCAL_QUERY, getStatus, live, onRedraw, opened, pushNow, syncNow, watchStatus, type Relayed, type Settle, type SyncStatus } from "./sync";
export { LINKS, NOTES, TASKS, projectLocal, readLinks, readNotes, readTasks } from "./local-records";
