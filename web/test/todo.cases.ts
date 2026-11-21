// The notes, tasks and links hooks over the local copy, with the services faked as a server that holds the rev contract: an edit
// is made on the copy and shows at once, goes up when a sync runs, and a stale one is merged, never sent over the newer.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import "./storage";
import { QueryClient } from "@tanstack/react-query";
import { parseNote } from "@/core/notes";
import { Conflict, Unavailable } from "@/core/pocketbase";
import { sameLink, type Link } from "@/core/record-links";
import { retagTask, taskOf, type Task } from "@/core/todo";

type Rev<T> = T & { rev: number };
const server = { tasks: new Map<string, Rev<Task>>(), notes: new Map<string, { rec: string; path: string; text: string; rev: number }>(), links: new Map<string, Link>(), down: false };
const sent: Record<string, unknown>[] = [];
/** The marks note writes went up with (`tainted`). */
const marks: string[] = [];
let lists = 0;
const net = async <T>(f: () => T): Promise<T> => { if (server.down) throw new Unavailable("network"); return f(); };

const noteRec = (r: { rec: string; path: string; text: string; rev: number }) => ({ ...r, kind: "note" as const, updated: "2026-11-01T10:00:00.000Z" });
// A faked module is the whole process's, not this file's: a test file run after this one imports the fake too. So it keeps
// what the service has beside its calls (`withNote`, which is pure); without it, those files found no such export whenever
// the runner happened to take this file first.
const service = await import("@/services/notes");
mock.module("@/services/notes", () => ({
  ...service,
  list:() => net(() => { lists++; return [...server.notes.values()].map((r) => ({ rec: r.rec, path: r.path, rev: r.rev, kind: "note" })); }),
  get: (rec: string) => net(() => { const r = server.notes.get(rec); return r ? noteRec(r) : null; }),
  read: (path: string) => net(() => { const r = [...server.notes.values()].find((x) => x.path === path); return r ? noteRec(r) : null; }),
  create: (rec: string, path: string, text: string, mark: object = {}) => net(() => {
    marks.push(`create ${JSON.stringify(mark)}`);
    if (server.notes.has(rec) || [...server.notes.values()].some((x) => x.path === path)) throw new Conflict(path);
    const r = { rec, path, text, rev: 1 };
    server.notes.set(r.rec, r);
    return noteRec(r);
  }),
  update: (e: { rec: string; rev: number }, text: string, mark: object = {}) => net(() => {
    marks.push(`update ${JSON.stringify(mark)}`);
    const r = server.notes.get(e.rec);
    if (!r) return null;
    if (r.rev !== e.rev) throw new Conflict("rev");
    const n = { ...r, text, rev: r.rev + 1 };
    server.notes.set(r.rec, n);
    return noteRec(n);
  }),
  remove: (e: { rec: string; rev: number }) => net(() => { if (server.notes.get(e.rec)?.rev !== e.rev) throw new Conflict("rev"); server.notes.delete(e.rec); }),
  memory: async () => null,
}));
mock.module("@/services/todo", () => ({
  tasks: {
    revs: () => net(() => [...server.tasks.values()].map((t) => ({ id: t.id, rev: t.rev }))),
    get: (id: string) => net(() => server.tasks.get(id) ?? null),
    getMany: (want: string[]) => net(() => want.flatMap((id) => (server.tasks.has(id) ? [server.tasks.get(id)!] : []))),
    create: (t: Task) => net(() => { if (server.tasks.has(t.id)) throw new Conflict(t.id); const r = { ...t, rev: 1 }; server.tasks.set(t.id, r); return r; }),
    update: (id: string, rev: number, fields: Record<string, unknown>) => net(() => {
      const cur = server.tasks.get(id);
      if (!cur) return null;
      sent.push(fields);
      if (cur.rev !== rev) throw new Conflict("rev");
      const n = { ...cur, ...fields, rev: cur.rev + 1 } as Rev<Task>;
      server.tasks.set(id, n);
      return n;
    }),
    remove: (id: string, rev: number) => net(() => { if (server.tasks.get(id)?.rev !== rev) throw new Conflict("rev"); server.tasks.delete(id); }),
  },
}));
mock.module("@/services/links", () => ({
  ids: () => net(() => [...server.links.keys()]),
  byIds: (want: string[]) => net(() => want.flatMap((id) => (server.links.has(id) ? [server.links.get(id)!] : []))),
  add: (l: Link) => net(() => { const had = [...server.links.values()].find((x) => x.id === l.id || sameLink(x, l)); if (had) return had; server.links.set(l.id, l); return l; }),
  remove: (id: string) => net(() => void server.links.delete(id)),
}));

const { createNote, deleteNote, landed, write, setFlags, NOTES } = await import("@/hooks/notes");
const { addTask, editTask, changeTask, removeTask, tickTask, TASKS } = await import("@/hooks/todo");
const { addLink, LINKS } = await import("@/hooks/links");
const { LENSES, setActiveLens } = await import("@/hooks/lens");
const { addItem } = await import("@/core/todo");
const { local } = await import("@/lib/local");
const { note } = await import("@/lib/net");
const { getStatus, heard, onRedraw, sync, syncNow } = await import("@/lib/sync");
const { projectLocal } = await import("@/lib/local-records");
const { noteDrafts, noteIdNow } = await import("@/lib/records");

let qc: QueryClient, stop: (() => void) | undefined;
beforeEach(async () => {
  for (const n of local.notes.all()) local.notes.delete(n.path);
  for (const t of local.tasks.all()) local.tasks.delete(t.id);
  for (const l of local.links.all()) local.links.delete(l.link.id);
  server.tasks.clear(); server.notes.clear(); server.links.clear(); server.down = false; sent.length = 0; marks.length = 0;
  qc = new QueryClient();
  stop?.();
  const redraw = onRedraw((topics) => projectLocal(qc, topics));
  const background = sync.start();
  stop = () => { background(); redraw(); };
  await syncNow();
  note("online");                                           // Bun has no `navigator.onLine`, which lib/net.ts reads as it loads
  setActiveLens(null);
});
afterEach(() => stop?.());
const cached = (id: string) => qc.getQueryData<{ id: string; rev: number; [k: string]: any }[]>(TASKS)?.find((t) => t.id === id);
const seen = () => qc.getQueryData<{ path: string; text: string }[]>(NOTES) ?? [];

describe("writes go to the copy first", () => {
  test("a new task shows at once at rev 0 and goes up under its own id", async () => {
    server.down = true;
    const t = await addTask(qc, { title: "  Call plumber ", when: "2026-11-03" });
    expect(t.rev).toBe(0);
    expect(cached(t.id)?.title).toBe("Call plumber");
    expect(getStatus().waiting).toBe(1);
    await syncNow();
    expect(server.tasks.size).toBe(0);                       // still down: it waits
    expect(getStatus().waiting).toBe(1);
    server.down = false;
    await syncNow();
    expect(server.tasks.get(t.id)).toMatchObject({ when: "2026-11-03", rev: 1 });
    expect(getStatus().waiting).toBe(0);
    expect(local.tasks.get(t.id)?.rev).toBe(1);
  });

  test("a note edited offline shows at once and goes up at the rev it was based on", async () => {
    const r = await createNote(qc, "Plan");
    await syncNow();
    server.down = true;
    const after = await write(r, (text) => `${text}more\n`);
    expect(seen().find((n) => n.path === r.path)?.text).toBe(after.text);
    expect(getStatus().waiting).toBe(1);
    server.down = false;
    await syncNow();
    expect([...server.notes.values()][0]).toMatchObject({ text: after.text, rev: 2 });
    expect(getStatus().waiting).toBe(0);
  });

  test("a note deleted offline leaves the list and the server on the next sync", async () => {
    const r = await createNote(qc, "Gone soon");
    await syncNow();
    server.down = true;
    await deleteNote(r);
    expect(seen()).toEqual([]);
    server.down = false;
    await syncNow();
    expect(server.notes.size).toBe(0);
    expect(local.notes.all()).toEqual([]);
  });

  test("a note edited on the server meanwhile merges at the sync", async () => {
    const r = await createNote(qc, "Merge", "l1\nl2\nl3\nl4\nl5");
    await syncNow();
    const rec = [...server.notes.keys()][0]!, theirs = server.notes.get(rec)!;
    server.notes.set(rec, { ...theirs, text: theirs.text.replace("l5", "l5 theirs"), rev: theirs.rev + 1 });
    await write(r, (text) => text.replace("l1", "l1 mine"));
    await syncNow();
    const text = [...server.notes.values()][0]!.text;
    expect(text).toContain("l1 mine");
    expect(text).toContain("l5 theirs");
    expect(getStatus().conflicts).toEqual([]);
  });

  test("overlapping edits are listed as a conflict and sent nowhere", async () => {
    const r = await createNote(qc, "Clash", "one");
    await syncNow();
    const rec = [...server.notes.keys()][0]!, theirs = server.notes.get(rec)!;
    server.notes.set(rec, { ...theirs, text: theirs.text.replace("one", "theirs"), rev: theirs.rev + 1 });
    await write(r, (text) => text.replace("one", "mine"));
    await syncNow();
    expect(getStatus().conflicts).toEqual([r.path]);
    expect([...server.notes.values()][0]!.text).toContain("theirs");
  });

  test("a note made here goes up under its own record id, and files wait for it to land where it stays", async () => {
    server.down = true;
    const r = await createNote(qc, "Shared");
    expect(r.rec).toMatch(/^[a-z0-9]{15}$/);
    await expect(landed(r.path)).rejects.toThrow("isn't on the server yet");
    server.notes.set("theirs", { rec: "theirs", path: r.path, text: "another device's", rev: 1 });   // its name taken meanwhile
    server.down = false;
    const at = await landed(r.path);
    expect(at).toMatch(/-shared-2\.md$/);
    expect(server.notes.get(r.rec)).toMatchObject({ path: at, rev: 1 });
    expect(await landed(at)).toBe(at);
  });

  test("a new note takes -2 when the server has the name", async () => {
    server.notes.set("x", { rec: "x", path: `notes/${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-plan.md`, text: "taken", rev: 1 });
    const r = await createNote(qc, "Plan");
    expect(r.path).toMatch(/-plan-2\.md$/);
  });

  test("under a lens a new task carries its first tag, once", async () => {
    qc.setQueryData(LENSES, [{ rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null, theme: null }]);
    setActiveLens("w");
    expect((await addTask(qc, { title: "a" })).tags).toEqual(["work"]);
    expect((await addTask(qc, { title: "b", tags: ["Work", "home"] })).tags).toEqual(["Work", "home"]);
    setActiveLens("gone");                                   // a lens deleted elsewhere is no lens
    expect((await addTask(qc, { title: "c" })).tags).toEqual([]);
    setActiveLens(null);
    expect((await addTask(qc, { title: "d" })).tags).toEqual([]);
  });

  test("under a lens a new note carries its first tag; under none or a deleted one, none", async () => {
    const tagsOf = (path: string) => parseNote(path, seen().find((n) => n.path === path)!.text).tags;
    qc.setQueryData(LENSES, [{ rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null, theme: null }]);
    expect(tagsOf((await createNote(qc, "Plan")).path)).toEqual([]);
    setActiveLens("w");
    expect(tagsOf((await createNote(qc, "Quarterly plan")).path)).toEqual(["work"]);
    setActiveLens("gone");
    expect(tagsOf((await createNote(qc, "Another plan")).path)).toEqual([]);
  });

  test("flags are a write like any other", async () => {
    const r = await createNote(qc, "Pin me");
    await setFlags(r, { pinned: true });
    expect(seen().find((n) => n.path === r.path)?.text).toContain("pinned: true");
  });
});

describe("tasks", () => {
  test("an edit goes up at the rev it was based on", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    sent.length = 0;
    await editTask(t.id, { due: "2026-11-10" });
    expect(cached(t.id)).toMatchObject({ due: "2026-11-10", rev: 1 });      // shown at once, as the server last had it
    await syncNow();
    expect(sent).toHaveLength(1);
    expect(server.tasks.get(t.id)).toMatchObject({ due: "2026-11-10", rev: 2 });
    expect(cached(t.id)?.rev).toBe(2);
  });

  test("an edit that changes nothing leaves nothing waiting", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    await editTask(t.id, { title: "a" });
    expect(getStatus().waiting).toBe(0);
  });

  test("a stale rev is merged with the newer record, keeping the other side's change", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    server.tasks.set(t.id, { ...server.tasks.get(t.id)!, notes: "from the phone", rev: 2 });          // another device wrote
    await editTask(t.id, { due: "2026-11-10" });
    await syncNow();
    expect(server.tasks.get(t.id)).toMatchObject({ due: "2026-11-10", notes: "from the phone", rev: 3 });
    expect(cached(t.id)?.notes).toBe("from the phone");
  });

  test("a checklist item added meanwhile survives an item added here", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    const theirs = addItem(taskOf(server.tasks.get(t.id)), "theirs");
    server.tasks.set(t.id, { ...server.tasks.get(t.id)!, checklist: theirs.checklist, rev: 2 });
    await changeTask(t.id, (cur) => addItem(cur, "mine"));
    await syncNow();
    expect((server.tasks.get(t.id)!.checklist as { text: string }[]).map((i) => i.text)).toEqual(["theirs", "mine"]);
  });

  test("a tag added here merges with the tag another device added", async () => {
    const t = await addTask(qc, { title: "a", tags: ["home"] });
    await syncNow();
    server.tasks.set(t.id, { ...server.tasks.get(t.id)!, tags: ["home", "errand"], rev: 2 });
    await changeTask(t.id, (cur) => retagTask(cur, ["Urgent"]));
    await syncNow();
    expect(server.tasks.get(t.id)?.rev).toBe(3);
    expect([...server.tasks.get(t.id)!.tags].sort()).toEqual(["Urgent", "errand", "home"]);       // a set: either side's addition is kept
  });

  test("a tag is taken off ignoring case, and one it already has is not added twice", async () => {
    const t = await addTask(qc, { title: "a", tags: ["Home", "work"] });
    await changeTask(t.id, (cur) => retagTask(cur, ["WORK"], ["home"]));
    expect(cached(t.id)?.tags).toEqual(["work"]);
  });

  test("a value the server would refuse stops the edit before it is written", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    await expect(editTask(t.id, { when: "soon" })).rejects.toThrow();
    expect(getStatus().waiting).toBe(0);
  });

  test("a task deleted elsewhere is said so once the sync has seen it", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    server.tasks.delete(t.id);
    await syncNow();
    await expect(editTask(t.id, { notes: "x" })).rejects.toThrow(/deleted/);
  });

  test("a task deleted here, offline, goes with its links", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    const l = await addLink({ type: "task", id: t.id }, { type: "note", id: "n1" }, "about");
    expect(qc.getQueryData<Link[]>(LINKS)?.map((x) => x.id)).toEqual([l.id]);
    server.down = true;
    await removeTask(cached(t.id) as never);
    expect(cached(t.id)).toBeUndefined();
    expect(qc.getQueryData<Link[]>(LINKS)).toEqual([]);
  });
});

describe("ticking", () => {
  test("a task is done today", async () => {
    const t = await addTask(qc, { title: "a" });
    await tickTask(t.id, true);
    await syncNow();
    expect(server.tasks.get(t.id)?.done).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await tickTask(t.id, false);
    await syncNow();
    expect(server.tasks.get(t.id)?.done).toBe("");
  });

  test("a repeating task is done without `every`, and its next round is a new record", async () => {
    const t = await addTask(qc, { title: "Water plants", when: "2026-10-01", every: "1w" });
    await tickTask(t.id, true);
    await syncNow();
    const all = [...server.tasks.values()];
    expect(all.length).toBe(2);
    const done = server.tasks.get(t.id)!, next = all.find((r) => r.id !== t.id)!;
    expect(done.every).toBe("");
    expect(next).toMatchObject({ every: "1w", done: "", title: "Water plants" });
    expect(String(next.when) > "2026-10-01").toBe(true);
  });

  test("the next round is about the same notes: its links made again from it, under new ids", async () => {
    const t = await addTask(qc, { title: "Pay rent", when: "2026-10-01", every: "1m" });
    await syncNow();
    const l1 = await addLink({ type: "task", id: t.id }, { type: "note", id: "n1" }, "about");
    await syncNow();
    await tickTask(t.id, true);
    await syncNow();
    const next = [...server.tasks.values()].find((r) => r.id !== t.id)!;
    const carried = [...server.links.values()].filter((l) => l.from.id === next.id);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ to: { type: "note", id: "n1" }, role: "about" });
    expect(carried[0]!.id).not.toBe(l1.id);
    expect(server.links.has(l1.id)).toBe(true);
  });

  test("ticking a task that doesn't repeat makes no links", async () => {
    const t = await addTask(qc, { title: "Once" });
    await syncNow();
    await addLink({ type: "task", id: t.id }, { type: "note", id: "n1" }, "about");
    await tickTask(t.id, true);
    await syncNow();
    expect(server.links.size).toBe(1);
  });
});

describe("an open note's typing", () => {
  const bodyOf = (text: string, path: string) => parseNote(path, text).body;

  test("typed into a note deleted on another device, it puts the note back with the text instead of being lost", async () => {
    const r = await createNote(qc, "Doomed", "start");
    await syncNow();
    const d = noteDrafts(r);
    d.body.type("start, and what I was typing");                   // not yet saved: the 800 ms haven't passed
    server.notes.delete(r.rec);                                     // deleted on the phone meanwhile
    await syncNow();                                                // the sync puts the typing in the copy before it pulls
    const back = server.notes.get(r.rec)!;
    expect(bodyOf(back.text, back.path)).toBe("start, and what I was typing");
    expect(seen().map((n) => n.path)).toEqual([r.path]);
    expect(d.body.pending()).toBe(false);
  });

  test("typed after the sync dropped the note, the text puts it back under its record id", async () => {
    const r = await createNote(qc, "Doomed", "start");
    await syncNow();
    const d = noteDrafts(r);
    server.notes.delete(r.rec);
    await syncNow();
    expect(seen()).toEqual([]);
    d.body.type("typed as the delete came in");
    await d.body.flush();
    await syncNow();
    expect(bodyOf(server.notes.get(r.rec)!.text, r.path)).toBe("typed as the delete came in");
  });

  test("a note moved aside to -2 on its first push keeps its draft, and its page finds it under its new id", async () => {
    server.down = true;
    const r = await createNote(qc, "Shared");
    const d = noteDrafts(r);
    d.body.type("plans");
    server.notes.set("theirs", { rec: "theirs", path: r.path, text: "another device's", rev: 1 });
    server.down = false;
    await syncNow();
    const moved = server.notes.get(r.rec)!, id = r.path.slice(6, -3);
    expect(moved.path).toMatch(/-shared-2\.md$/);
    expect(bodyOf(moved.text, moved.path)).toBe("plans");
    expect(noteIdNow(id)).toBe(moved.path.slice(6, -3));
    d.body.type("more");
    await d.body.flush();
    await syncNow();
    expect(bodyOf(server.notes.get(r.rec)!.text, moved.path)).toBe("more");
    expect(server.notes.get("theirs")!.text).toBe("another device's");
  });

  test("a link's summary put in goes up with the tainted mark, and the note's later saves carry none of their own", async () => {
    const r = await createNote(qc, "Links", "https://example.com");
    await syncNow();
    const d = noteDrafts(r);
    d.body.type("https://example.com\n\n> **Summary**\n> a model's words");
    d.body.taint();
    await d.body.flush();
    expect(local.notes.get(r.path)?.tainted).toBe(true);
    await syncNow();
    d.body.type("mine again");                                    // the next typed is marked too: the insert may reach the draft after it says so
    await d.body.flush();
    await syncNow();
    d.body.type("and again");
    await d.body.flush();
    await syncNow();
    expect(marks).toEqual(["create {}", 'update {"tainted":true}', 'update {"tainted":true}', "update {}"]);
  });
});

describe("the realtime feed", () => {
  test("a note another device changed is news, and the echo of what this app sent is not", async () => {
    const r = await createNote(qc, "Echo");
    await syncNow();
    const rec = [...server.notes.values()][0]!;
    lists = 0;
    heard("notes", "update", { id: rec.rec, path: rec.path, rev: rec.rev });          // the rev this copy has: the echo
    await Bun.sleep(300);
    expect(lists).toBe(0);
    heard("notes", "update", { id: rec.rec, path: rec.path, rev: rec.rev + 1 });
    await Bun.sleep(300);
    expect(lists).toBe(1);
    heard("notes", "update", { id: "m", path: "agent/memory.md", rev: 9 });             // not a note this app syncs
    await Bun.sleep(300);
    expect(lists).toBe(1);
    expect(r.path).toBe(rec.path);
  });

  test("a task or link the copy lacks is news; one it has is not", async () => {
    const t = await addTask(qc, { title: "a" });
    await syncNow();
    lists = 0;
    heard("tasks", "update", { id: t.id, rev: 1 });
    heard("links", "create", { id: "unknown" });
    await Bun.sleep(300);
    expect(lists).toBe(1);                                   // two events, one sync
  });
});
