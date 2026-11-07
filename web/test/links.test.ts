// The web app's questions of the links (lib/links.ts): a task's notes as the cache has them, a note's tasks, a task row's
// summary, a realtime change into the list, what a cascade leaves, and where a task opens.
import { describe, expect, test } from "bun:test";
import { linkRecord, type Link } from "@/core/record-links";
import { applyLinkChange, linkedNoteIds, noteSummary, notesFor, taskView, tasksFor, withoutEnd } from "@/lib/links";
import type { NoteRec } from "@/services/notes";

const about = (id: string, task: string, note: string): Link => ({ id, from: { type: "task", id: task }, to: { type: "note", id: note }, role: "about" });
const note = (rec: string, title: string): NoteRec =>
  ({ rec, path: `notes/${rec}.md`, rev: 1, kind: "note", text: "", updated: "", note: { id: rec, title, created: "", body: "", pinned: false, tags: [] } });

const links: Link[] = [
  about("l1", "t1", "n1"), about("l2", "t1", "n2"), about("l3", "t1", "gone"), about("l4", "t2", "n1"),
  { id: "l5", from: { type: "note", id: "n2" }, to: { type: "note", id: "n1" }, role: "source" },
  { id: "l6", from: { type: "task", id: "t3" }, to: { type: "note", id: "n1" }, role: "source" },
];
const notes = [note("n1", "Lease"), note("n2", "Bank")];

describe("a task's notes", () => {
  test("every note it is about, in link order, those not cached yet counted", () => {
    const { linked, unseen } = notesFor(links, "t1", notes);
    expect(linked.map((x) => [x.link.id, x.n.note.title])).toEqual([["l1", "Lease"], ["l2", "Bank"]]);
    expect(unseen).toBe(1);
  });
  test("a task about nothing has none", () => {
    expect(notesFor(links, "none", notes)).toEqual({ linked: [], unseen: 0 });
  });
  test("the picker leaves out what is linked already", () => {
    expect([...linkedNoteIds(links, "t1")]).toEqual(["n1", "n2", "gone"]);
  });
  test("a row names the first known note and counts the rest", () => {
    const titles = new Map(notes.map((n) => [n.rec, n.note.title]));
    expect(noteSummary(links, "t1", titles)).toEqual({ title: "Lease", more: 1 });
    expect(noteSummary(links, "t2", titles)).toEqual({ title: "Lease", more: 0 });
    expect(noteSummary(links, "none", titles)).toBeNull();
  });
});

describe("a note's tasks", () => {
  test("every task linking to it, of any role, once each, only those cached", () => {
    const tasks = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    expect(tasksFor([...links, about("l8", "t1", "n1")], "n1", tasks).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(tasksFor(links, "n1", [{ id: "t2" }]).map((t) => t.id)).toEqual(["t2"]);
    expect(tasksFor(links, "n9", tasks)).toEqual([]);
  });
});

describe("the realtime feed", () => {
  test("a create goes in once, a delete comes out, a record that isn't a link is left out", () => {
    const l = about("l9", "t9", "n9");
    const once = applyLinkChange(links, "create", linkRecord(l));
    expect(once.at(-1)).toEqual(l);
    expect(applyLinkChange(once, "create", linkRecord(l))).toHaveLength(once.length);
    expect(applyLinkChange(once, "delete", { id: "l9" })).toEqual(links);
    expect(applyLinkChange(links, "create", { id: "bad", fromTask: "t1", role: "about" })).toEqual(links);
  });
  test("a note or a task gone takes every link touching it", () => {
    expect(withoutEnd(links, { type: "note", id: "n1" }).map((l) => l.id)).toEqual(["l2", "l3"]);
    expect(withoutEnd(links, { type: "task", id: "t1" }).map((l) => l.id)).toEqual(["l4", "l5", "l6"]);
  });
});

describe("where a task opens", () => {
  const t = { done: "", when: "" };
  test("Logbook, Today, Upcoming, else Inbox", () => {
    expect(taskView({ ...t, done: "2026-11-01", when: "2026-11-02" }, "2026-11-02")).toEqual({ kind: "logbook" });
    expect(taskView({ ...t, when: "2026-11-02" }, "2026-11-02")).toEqual({ kind: "today" });
    expect(taskView({ ...t, when: "2026-11-03" }, "2026-11-02")).toEqual({ kind: "upcoming" });
    expect(taskView(t, "2026-11-02")).toEqual({ kind: "inbox" });
  });
});
