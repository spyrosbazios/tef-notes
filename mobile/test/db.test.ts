/// <reference types="node" />
// db.ts's SQL on a real SQLite: node:sqlite behind the few expo-sqlite calls it makes. Schema, triggers,
// FTS5 over the folded copy, snippets in the original text, and the LIKE fallback without FTS5.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIT, parseNote } from "@/core/notes";
import type * as Db from "../src/store/db";

const files = new Map<string, DatabaseSync>();
const flags = vi.hoisted(() => ({ noFts: false }));

vi.mock("expo-sqlite", () => ({
  openDatabaseSync: (name: string) => {
    const d = files.get(name) ?? new DatabaseSync(":memory:");
    files.set(name, d);
    const args = (p: unknown[] = []) => p as (string | number | null)[];
    return {
      execSync: (sql: string) => { if (flags.noFts && /using fts5/i.test(sql)) throw new Error("no such module: fts5"); d.exec(sql); },
      runSync: (sql: string, p?: unknown[]) => ({ changes: Number(d.prepare(sql).run(...args(p)).changes) }),
      getFirstSync: (sql: string, p?: unknown[]) => d.prepare(sql).get(...args(p)) ?? null,
      getAllSync: (sql: string, p?: unknown[]) => d.prepare(sql).all(...args(p)),
      withTransactionSync: (task: () => void) => {
        d.exec("BEGIN");
        try { task(); d.exec("COMMIT"); } catch (e) { d.exec("ROLLBACK"); throw e; }
      },
    };
  },
}));

const open = async () => { vi.resetModules(); return (await import("../src/store/db")) as typeof Db; };
const row = (path: string, text: string, p: Partial<Db.NoteRow> = {}): Db.NoteRow => {
  const n = parseNote(path, text);
  return {
    path, id: n.id, text, title: n.title, created: n.created, pinned: n.pinned, color: n.color ?? null, tags: n.tags, kind: "note", snippet: "s",
    updated: 1, pushed: 1, rec: "r1", rev: 1, base: text, conflict_text: null, conflict_rev: null, lost: null, deleted: false, ...p,
  };
};
const mark = (s: string) => s.replaceAll(HIT[0], "[").replaceAll(HIT[1], "]");
const GARAGE = "notes/20261005-garage.md", SHOP = "notes/20261004-shopping.md";

let db: typeof Db;
beforeEach(async () => {
  files.clear();
  flags.noFts = false;
  db = await open();
  db.putNote(row(GARAGE, "---\ntitle: Κωδικοί γκαράζ\ncreated: 2026-10-05\npinned: true\ntags: [σπίτι]\n---\nΗ πόρτα έξω έχει κωδικό 1234. Ξαναλέω: η ΠΌΡΤΑ.\n", { updated: 5, pushed: 5 }));
  db.putNote(row(SHOP, "---\ntitle: Shopping\ncreated: 2026-10-04\n---\n- milk\n- café au lait\n", { updated: 9, pushed: 3 }));
  db.putNote(row("agent/memory.md", "# Memory\n\nLikes πόρτα jokes.\n", { updated: 7, pushed: 7 }));
});

describe("db", () => {
  it("migrates once and opens again as it was", async () => {
    expect(db.fts).toBe(true);
    const again = await open();
    expect(again.getNote(GARAGE)).toMatchObject({ title: "Κωδικοί γκαράζ", pinned: true, tags: ["σπίτι"], deleted: false, color: null });
    expect(files.get("tefnotes.db")!.prepare("PRAGMA user_version").get()).toEqual({ user_version: 13 });
  });

  it("drops the notes' tasks column (version 8) and sticky column (version 9) from version 7, the notes as they were", async () => {
    files.clear();
    const old = new DatabaseSync(":memory:");
    files.set("tefnotes.db", old);
    await open();
    old.exec(`ALTER TABLE notes ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]'; ALTER TABLE notes DROP COLUMN kind; DROP TABLE links; ALTER TABLE notes ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE notes ADD COLUMN sticky INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 7;`);
    const text = "---\ntitle: Shopping\n---\n- [ ] milk\n";
    old.prepare("INSERT INTO notes (path, id, text, title, updated, tasks) VALUES (?, ?, ?, ?, 1, '[{}]')").run(SHOP, "s", text, "Shopping");
    const again = await open();
    expect(again.getNote(SHOP)?.text).toBe(text);
    expect(old.prepare("SELECT name FROM pragma_table_info('notes') WHERE name IN ('tasks', 'sticky')").all()).toEqual([]);
  });

  it("gives the notes of version 9 a kind (version 10), `note` until a pull says otherwise, and adds the links (version 11)", async () => {
    files.clear();
    const old = new DatabaseSync(":memory:");
    files.set("tefnotes.db", old);
    await open();
    old.exec("ALTER TABLE notes ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]'; ALTER TABLE notes DROP COLUMN kind; DROP TABLE links; PRAGMA user_version = 9;");
    old.prepare("INSERT INTO notes (path, id, text, title, updated) VALUES (?, ?, ?, ?, 1)").run("notes/20261102-shots-143205.md", "c", "x", "Shots");
    const again = await open();
    expect(again.getMeta("notes/20261102-shots-143205.md")?.kind).toBe("note");
    expect(again.syncState()[0].kind).toBe("note");
  });

  it("drops the projects and a task's project and heading (version 12), the rest of the task as it was", async () => {
    files.clear();
    const old = new DatabaseSync(":memory:");
    files.set("tefnotes.db", old);
    await open();
    old.exec("ALTER TABLE notes ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 11;");
    const t = { id: "t1", title: "Call", project: "p1", heading: "Kitchen", order: 2 };
    const put = old.prepare("INSERT INTO records (coll, id, data, base, rev, updated, pushed) VALUES (?, ?, ?, ?, 1, 1, 1)");
    put.run("tasks", "t1", JSON.stringify(t), JSON.stringify(t));
    put.run("tasks", "t2", JSON.stringify({ id: "t2", title: "New", project: "p1" }), null);
    put.run("projects", "p1", JSON.stringify({ id: "p1", title: "House" }), null);
    const again = await open();
    expect(again.getRecord("tasks", "t1")).toMatchObject({ data: { id: "t1", title: "Call", order: 2 }, base: { id: "t1", title: "Call", order: 2 } });
    expect(again.getRecord("tasks", "t2")).toMatchObject({ data: { id: "t2", title: "New" }, base: null });
    expect(old.prepare("SELECT coll, id FROM records ORDER BY id").all()).toEqual([{ coll: "tasks", id: "t1" }, { coll: "tasks", id: "t2" }]);
  });

  it("drops the server's tag suggestions from the notes and the tasks (version 13), the rest as it was", async () => {
    files.clear();
    const old = new DatabaseSync(":memory:");
    files.set("tefnotes.db", old);
    await open();
    old.exec("ALTER TABLE notes ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 12;");
    old.prepare("INSERT INTO notes (path, id, text, title, updated, suggested) VALUES (?, ?, ?, ?, 1, '[\"home\"]')").run(SHOP, "s", "x", "Shopping");
    const t = { id: "t1", title: "Call", tags: ["work"], suggested: ["home"] };
    old.prepare("INSERT INTO records (coll, id, data, base, rev, updated, pushed) VALUES ('tasks', 't1', ?, ?, 1, 1, 1)").run(JSON.stringify(t), JSON.stringify(t));
    const again = await open();
    expect(again.getNote(SHOP)).toMatchObject({ title: "Shopping", text: "x" });
    expect(old.prepare("SELECT name FROM pragma_table_info('notes') WHERE name = 'suggested'").all()).toEqual([]);
    expect(again.getRecord("tasks", "t1")).toEqual(expect.objectContaining({ data: { id: "t1", title: "Call", tags: ["work"] }, base: { id: "t1", title: "Call", tags: ["work"] } }));
  });

  it("keeps links: their ends and role, sync state, tombstones, oldest first", () => {
    const a = { id: "l1", from: { type: "task", id: "t1" }, to: { type: "note", id: "n1" }, role: "about" } as const;
    const b = { id: "l2", from: { type: "note", id: "n2" }, to: { type: "task", id: "t2" }, role: "source" } as const;
    db.putLink({ link: a, pushed: null, deleted: false });
    db.putLink({ link: b, pushed: 5, deleted: false });
    expect(db.getLink("l1")).toEqual({ link: a, pushed: null, deleted: false });
    db.putLink({ link: a, pushed: 7, deleted: true });
    expect(db.linkRows()).toEqual([{ link: a, pushed: 7, deleted: true }, { link: b, pushed: 5, deleted: false }]);
    db.deleteLink("l1");
    expect(db.getLink("l1")).toBeNull();
    expect(db.linkRows().map((r) => r.link.id)).toEqual(["l2"]);
  });

  it("starts the cache over when coming from the GitHub schema, search and all", async () => {
    files.clear();
    const old = new DatabaseSync(":memory:");
    old.exec(`CREATE TABLE notes (rid INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, id TEXT NOT NULL, text TEXT NOT NULL, title TEXT NOT NULL,
      updated INTEGER NOT NULL, sha TEXT, ft_title TEXT NOT NULL DEFAULT '', ft_body TEXT NOT NULL DEFAULT '');
      CREATE TABLE attachments (note_id TEXT NOT NULL, name TEXT NOT NULL, sha TEXT, PRIMARY KEY (note_id, name));
      CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content = 'notes', content_rowid = 'rid');
      INSERT INTO notes (path, id, text, title, updated, sha, ft_title) VALUES ('notes/x.md', 'x', 'x', 'Old', 1, 's1', 'old');
      INSERT INTO attachments VALUES ('x', 'a.jpg', 's2');
      PRAGMA user_version = 1;`);
    files.set("tefnotes.db", old);
    const fresh = await open();
    expect(fresh.allMeta()).toEqual([]);
    expect(fresh.allAttachments()).toEqual([]);
    fresh.putNote(row(GARAGE, "---\ntitle: Garage\ncreated: 2026-10-05\n---\nπόρτα 1234\n"));
    expect(fresh.search("πορτα").map((h) => h.path)).toEqual([GARAGE]);
    expect(fresh.getNote(GARAGE)).toMatchObject({ rec: "r1", rev: 1 });
  });

  it("lists every live row, pinned first then latest, with conflict and lost as flags", () => {
    db.patchNote(SHOP, { conflict_rev: 2, conflict_text: "t", lost: "old" });
    db.putNote(row("notes/20261001-gone.md", "x", { deleted: true, updated: 99 }));
    expect(db.allMeta().map((m) => [m.path, m.conflict, m.lost])).toEqual([[GARAGE, false, false], [SHOP, true, true], ["agent/memory.md", false, false]]);
    expect(db.allMeta()[0]).not.toHaveProperty("text");
    expect(db.dirtyPaths()).toEqual([SHOP]);
    expect(db.tombstones().map((t) => t.path)).toEqual(["notes/20261001-gone.md"]);
    expect(db.syncState().find((s) => s.path === SHOP)).toEqual({ path: SHOP, rev: 1, dirty: true, deleted: false, conflict: true, kind: "note" });
    expect(db.allPaths()).toHaveLength(4);
    expect(db.getMeta("notes/20261001-gone.md")).toBeNull();
  });

  it("finds Greek typed without tonos, and shows the match in the text as written", () => {
    const [h] = db.search("πορτα");
    expect(h.path).toBe(GARAGE);
    expect(mark(h.snippet)).toBe("Η [πόρτα] έξω έχει κωδικό 1234. Ξαναλέω: η [ΠΌΡΤΑ].");
    expect(db.search("ΚΩΔΙΚ").map((x) => x.path)).toEqual([GARAGE]);           // the last word is a prefix
    expect(db.search("cafe lait").map((x) => x.path)).toEqual([SHOP]);
    expect(db.search("γκαραζ")[0].rank).toBeLessThan(0);
  });

  it("weighs a title hit over a body hit", () => {
    db.putNote(row("notes/20261006-a.md", "---\ntitle: Notes\ncreated: 2026-10-06\n---\nmilk milk milk\n"));
    db.putNote(row("notes/20261006-b.md", "---\ntitle: Milk\ncreated: 2026-10-06\n---\nabout it\n"));
    expect(db.search("milk")[0].path).toBe("notes/20261006-b.md");
  });

  it("matches a word against tags too, after the text matches, with every word somewhere", () => {
    db.putNote(row("notes/20261006-keys.md", "---\ntitle: Keys\ncreated: 2026-10-06\ntags: [Σπίτι]\n---\nspare keys\n", { updated: 8 }));
    expect(db.search("σπιτι").map((h) => h.path)).toEqual(["notes/20261006-keys.md", GARAGE]);   // tag only, newest first
    expect(db.search("keys ΣΠΙΤΙ").map((h) => h.path)).toEqual(["notes/20261006-keys.md"]);      // one word in the text, one in the tag
    expect(db.search("milk σπιτι")).toEqual([]);
    expect(db.search("πορτα")[0].rank).toBeLessThan(0);
    db.putNote(row("notes/20261006-tagged.md", "---\ntitle: Other\ncreated: 2026-10-06\ntags: [πορτες]\n---\nx\n", { updated: 2 }));
    expect(db.search("πορτα").map((h) => h.path)).toEqual([GARAGE]);                              // a text hit leads; `πορτες` doesn't hold "πορτα"
  });

  it("keeps the index in step through edits and deletes; tombstones and memory never show", () => {
    db.patchNote(GARAGE, { text: "---\ntitle: Κωδικοί γκαράζ\ncreated: 2026-10-05\n---\nτίποτα πια\n" });
    expect(db.search("πορτα").map((h) => h.path)).toEqual([]);                   // memory has it too, but isn't a note
    expect(db.search("τιποτα").map((h) => h.path)).toEqual([GARAGE]);
    db.patchNote(GARAGE, { title: "Άλλος τίτλος" });
    expect(db.search("αλλος").map((h) => h.path)).toEqual([GARAGE]);
    db.patchNote(SHOP, { deleted: true });
    expect(db.search("milk")).toEqual([]);
    db.deleteNote(GARAGE);
    expect(db.search("τιποτα")).toEqual([]);
    files.get("tefnotes.db")!.exec("INSERT INTO notes_fts (notes_fts, rank) VALUES ('integrity-check', 0)");
  });

  it("shows a snippet as plain text, not the markdown it was written in", () => {
    db.putNote(row("notes/20261006-md.md", "---\ntitle: Md\ncreated: 2026-10-06\n---\n<https://example.com>\n- [x] check me\n- f\\[ m\n- \n- **seco** pm]tn\\*\\*bo\\* tt\n"));
    expect(db.search("seco").map((h) => mark(h.snippet))).toEqual(["https://example.com check me f[ m [seco] pm]tn**bo* tt"]);
  });

  it("makes any typed query safe", () => {
    for (const q of ['"', "milk\"", "AND", "milk OR", "-x", "a*b", "(", "NEAR(", "col:milk", "^"]) expect(() => db.search(q)).not.toThrow();
    expect(db.search('"milk"').map((h) => h.path)).toEqual([SHOP]);
    expect(db.search("   ")).toEqual([]);
  });

  it("finds nothing, without throwing, for a query of only marks that fold away", () => {
    expect(db.search("\u0301")).toEqual([]);
    expect(db.search(" \u0301 \u0308 ")).toEqual([]);
  });

  it("falls back to LIKE for a query of only punctuation", () => {
    db.putNote(row("notes/20261006-c.md", "---\ntitle: C\ncreated: 2026-10-06\n---\nprice: 5 €, 50%_off\n"));
    expect(db.search("%_").map((h) => [h.path, mark(h.snippet)])).toEqual([["notes/20261006-c.md", "price: 5 €, 50[%_]off"]]);
    expect(db.search("€").map((h) => h.path)).toEqual(["notes/20261006-c.md"]);
    expect(db.search("%")).toHaveLength(1);                                      // a literal %, not a wildcard
  });

  it("works without FTS5: LIKE over the folded copy", async () => {
    files.clear();
    flags.noFts = true;
    db = await open();
    expect(db.fts).toBe(false);
    db.putNote(row(GARAGE, "---\ntitle: Κωδικοί γκαράζ\ncreated: 2026-10-05\n---\nΗ πόρτα έξω.\n"));
    expect(db.search("ΠΟΡΤΑ εξω").map((h) => [h.path, mark(h.snippet)])).toEqual([[GARAGE, "Η [πόρτα] έξω."]]);
    expect(db.search("κωδικοι")[0].snippet).toBe("s");                           // a title hit: the note's own snippet
  });

  it("shows the LIKE fallback's snippet as plain text too", async () => {
    files.clear();
    flags.noFts = true;
    db = await open();
    db.putNote(row("notes/20261006-md.md", "---\ntitle: Md\ncreated: 2026-10-06\n---\n<https://example.com>\n- [x] check me\n- \n- **seco** f\\[ m\n"));
    expect(db.search("seco").map((h) => mark(h.snippet))).toEqual(["https://example.com check me [seco] f[ m"]);
  });

  it("builds the index for notes stored before FTS5 was there", async () => {
    files.clear();
    flags.noFts = true;
    db = await open();
    db.putNote(row(SHOP, "---\ntitle: Shopping\ncreated: 2026-10-04\n---\n- milk\n"));
    flags.noFts = false;
    db = await open();
    expect(db.fts).toBe(true);
    expect(db.search("milk").map((h) => h.path)).toEqual([SHOP]);
  });

  it("keeps attachment rows", () => {
    db.putAttachment({ note_id: "n", name: "b.jpg", rec: "p1", file: "b_x.jpg", local: null, size: 3, pushed: 1 });
    db.putAttachment({ note_id: "n", name: "a.jpg", rec: null, file: null, local: "file:///a.jpg", size: null, pushed: null });
    expect(db.patchAttachment("n", "b.jpg", { local: "file:///b.jpg" })).toBe(true);
    expect(db.patchAttachment("n", "nope.jpg", { local: "x" })).toBe(false);
    expect(db.getAttachments("n").map((a) => [a.name, a.local])).toEqual([["a.jpg", "file:///a.jpg"], ["b.jpg", "file:///b.jpg"]]);
    db.putAttachment({ note_id: "n", name: "b.jpg", rec: "p2", file: "b_y.jpg", local: null, size: 4, pushed: 2 });
    expect(db.getAttachment("n", "b.jpg")).toEqual({ note_id: "n", name: "b.jpg", rec: "p2", file: "b_y.jpg", local: null, size: 4, pushed: 2 });
    db.deleteAttachment("n", "a.jpg");
    expect(db.allAttachments().map((a) => a.name)).toEqual(["b.jpg"]);
  });

  it("keeps task rows: their JSON, sync state, dirt and tombstones", () => {
    const t = { id: "t1", title: "Call", checklist: [{ id: "a", text: "x", done: false }] };
    db.putRecord({ coll: "tasks", id: "t1", data: t, base: null, rev: null, updated: 2, pushed: null, deleted: false });
    db.putRecord({ coll: "tasks", id: "t2", data: { id: "t2", title: "House" }, base: { id: "t2", title: "House" }, rev: 3, updated: 1, pushed: 1, deleted: false });
    expect(db.getRecord("tasks", "t1")).toEqual({ coll: "tasks", id: "t1", data: t, base: null, rev: null, updated: 2, pushed: null, deleted: false });
    expect(db.allRecords("tasks").map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    expect(db.dirtyRecords("tasks").map((r) => r.id)).toEqual(["t1"]);
    expect(db.patchRecord("tasks", "t1", { rev: 1, base: t, pushed: 2 })).toBe(true);
    expect(db.patchRecord("tasks", "nope", { rev: 1 })).toBe(false);
    expect(db.recordStates("tasks").find((r) => r.id === "t1")).toEqual({ id: "t1", rev: 1, dirty: false, deleted: false });
    db.patchRecord("tasks", "t1", { deleted: true });
    expect(db.allRecords("tasks").map((r) => r.id)).toEqual(["t2"]);
    expect(db.recordTombstones("tasks").map((r) => r.base)).toEqual([t]);
    db.deleteRecord("tasks", "t1");
    expect(db.getRecord("tasks", "t1")).toBeNull();
    expect(db.getRecord("tasks", "t2")?.rev).toBe(3);
  });
});
