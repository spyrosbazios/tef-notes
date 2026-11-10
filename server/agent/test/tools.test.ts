// The agent's view of the notes: the prompt's index lines, which paths its tools may touch, read_note's cap, and
// every write through the rev compare-and-swap, against a fake PocketBase (fake-pb.ts).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { cardsOf } from "@/core/agent";
import { parseNote } from "@/core/notes";
import { approvals } from "../src/agent";
import { Notes } from "../src/notes";
import { newTask, type Task } from "@/core/todo";
import { localDay } from "@/core/time";
import { linkRecord, newLink } from "@/core/record-links";
import { Todo } from "../src/todo";
import { checkAdd, checkAddMany, checkTask, checkUpdate } from "../src/todoTools";
import { ago, appended, checkWrite, indexLine, noteIndex, NOTE_RE, READ_RE, readWeb, tools, type Line } from "../src/tools";
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());

let notes: Notes, todo: Todo, T: ReturnType<typeof tools>;
beforeEach(() => {
  pb.notes.clear(); pb.chats.clear(); pb.tasks.clear(); pb.links.clear(); pb.created.length = 0; pb.meanwhile();
  pb.lenses.length = 0; pb.tags.splice(0, pb.tags.length, { id: "t1", name: "Σπίτι", description: "" }, { id: "t2", name: "work", description: "" });
  notes = new Notes({ url: pb.url });
  todo = new Todo({ url: pb.url });
  T = tools(notes, todo);
});

const run = <I,>(t: { execute?: (i: I, o: never) => unknown }, i: I, messages: ModelMessage[] = []) => t.execute!(i, { toolCallId: "c", messages } as never);
const file = (title: string, body = "- x\n", extra = "") => `---\ntitle: ${title}\ncreated: 2026-10-01\n${extra}---\n${body}`;
const web: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "w", toolName: "web_search", output: { type: "json", value: {} } }] };

const DAY = 86_400_000, NOW = new Date(2026, 9, 5, 12).getTime();
const line = (slug: string, o: Partial<Line> = {}): Line => ({ path: `notes/${slug}.md`, title: slug, updated: NOW, pinned: false, tags: [], ...o });

describe("index lines", () => {
  it("path · title · [tags] · flags · age, empty parts left out", () => {
    expect(indexLine(line("20261001-garage", { title: "Garage door codes", tags: ["home", "codes"], pinned: true, updated: NOW - 4 * DAY }), NOW))
      .toBe("notes/20261001-garage.md · Garage door codes · [home, codes] · pinned · 4d ago");
    expect(indexLine(line("20261005-x", { title: "Ψώνια" }), NOW)).toBe("notes/20261005-x.md · Ψώνια · today");
  });
  it("ago: whole days, today under one", () => {
    expect(ago(NOW - DAY + 1, NOW)).toBe("today");
    expect(ago(NOW - DAY, NOW)).toBe("1d ago");
    expect(ago(NOW + 5000, NOW)).toBe("today");    // a clock a little ahead
  });
});

describe("noteIndex", () => {
  it("every pinned note first, then the newest of the rest, then how many more", () => {
    const old = line("old-pinned", { pinned: true, updated: NOW - 300 * DAY });
    const rest = Array.from({ length: 5 }, (_, i) => line(`n${i}`, { updated: NOW - i * DAY }));
    const pinned = line("pinned", { pinned: true, updated: NOW - 2 * DAY });
    const lines = noteIndex([rest[3], old, rest[0], rest[4], pinned, rest[1], rest[2]], NOW, 3).split("\n");
    expect(lines.slice(0, 5).map((l) => l.split(" · ")[0])).toEqual(["notes/pinned.md", "notes/old-pinned.md", "notes/n0.md", "notes/n1.md", "notes/n2.md"]);
    expect(lines[5]).toBe("(2 older notes not listed: search_notes or list_notes finds them)");
  });
  it("no overflow line when all fit; the memory file isn't a note", () => {
    expect(noteIndex([line("a"), { ...line("m"), path: "agent/memory.md" }], NOW)).toBe("notes/a.md · a · today");
    expect(noteIndex([], NOW)).toBe("(no notes yet)");
  });
});

describe("paths", () => {
  it("read_note: a note one level down, or the memory file — nothing else", () => {
    for (const p of ["notes/20261005-welcome.md", "notes/20261005-garage-door-2.md", "agent/memory.md", "notes/Λίστα.md", "notes/x y.md"]) expect(READ_RE.test(p)).toBe(true);
    for (const p of ["notes/../CLAUDE.md", "notes/sub/x.md", "notes/x.txt", "/notes/x.md", "notes/.md", "notes/x.md\n", "agent/other.md",
      "attachments/20261005-welcome/a.jpg", "mobile/CLAUDE.md", "notes/..md", "notes/a..b.md", "notes/a\\b.md", "notes/a\tb.md", "agent/memory.mdx"])
      expect(READ_RE.test(p)).toBe(false);
    expect(NOTE_RE.test("notes/Λίστα.md")).toBe(true);
  });
  it("writes: notes only, and only one that exists", async () => {
    pb.put("notes/20261005-welcome.md", file("Welcome"));
    pb.put("agent/memory.md", "who\n");
    expect(NOTE_RE.test("agent/memory.md")).toBe(false);
    expect(await checkWrite(notes, "notes/20261005-welcome.md")).toBeNull();
    expect(await checkWrite(notes, "notes/20261005-nope.md")).toMatch(/^No note/);
    expect(await checkWrite(notes, "agent/memory.md")).toMatch(/^Not a note path/);
  });
  it("a rewrite's body can't bring a frontmatter block of its own", async () => {
    pb.put("notes/a.md", file("a"));
    expect(await checkWrite(notes, "notes/a.md", "---\ntitle: x\n---\nbody")).toMatch(/^Send the body only/);
    expect(await checkWrite(notes, "notes/a.md", "body\n\n---\n\nmore")).toBeNull();     // a rule further down is fine
  });
});

describe("read_note", () => {
  it("refuses a path outside notes/ and agent/memory.md", async () => {
    expect(await run(T.read_note, { path: "../secrets.md" })).toEqual({ error: "Only notes/<file>.md and agent/memory.md." });
  });
  it("hands back the whole file, cut at 20 000 chars and saying so", async () => {
    pb.put("notes/a.md", "x".repeat(25_000));
    expect(await run(T.read_note, { path: "notes/a.md" })).toEqual({ path: "notes/a.md", text: "x".repeat(20_000), truncated: true, chars: 25_000 });
  });
  it("says so when there's no such note", async () => {
    expect(await run(T.read_note, { path: "notes/a.md" })).toEqual({ error: "notes/a.md not found." });
  });
});

describe("list_notes", () => {
  it("filters the index, newest edit first, flags and tags only when set", async () => {
    pb.put("notes/a.md", file("a", "- x\n", "tags: [Home]\n"), { updated: "2026-10-04 12:00:00.000Z" });
    pb.put("notes/b.md", file("b", "Codes\n", "pinned: true\ncolor: yellow\n"));
    pb.put("notes/c.md", file("c", "- x\n", "tags: [work]\n"));
    const s = await run(T.list_notes, { filter: "pinned" }) as { notes: object[] };
    expect(s.notes).toEqual([{ path: "notes/b.md", title: "b", snippet: "Codes", flags: "pinned", color: "yellow", edited: expect.any(String) }]);
  });
});

describe("create_lens", () => {
  it("saves a lens with its tags spelled as defined; an unknown tag or none at all is refused", async () => {
    expect(await run(T.create_lens, { name: "Home", tags: ["σπιτι"], exclude: ["WORK"], accent: "teal" })).toMatchObject({ saved: "Home", tags: ["Σπίτι"], exclude: ["work"] });
    expect(pb.lenses).toEqual([expect.objectContaining({ name: "Home", tags: ["Σπίτι"], exclude: ["work"], accent: "teal" })]);
    expect(await run(T.create_lens, { name: "X", tags: ["nope"] })).toEqual({ error: expect.stringMatching(/^Not an existing tag: nope/) });
    expect(await run(T.create_lens, { name: "X", tags: [] })).toEqual({ error: expect.stringMatching(/at least one tag/) });
    expect(pb.lenses.length).toBe(1);
  });
});

describe("list_tagged", () => {
  it("notes and tasks with any or all of the tags, folded; done tasks only when asked", async () => {
    pb.put("notes/a.md", file("a", "- x\n", "tags: [Σπίτι, work]\n"), { updated: "2026-10-04 12:00:00.000Z" });
    pb.put("notes/b.md", file("b", "- x\n", "tags: [work]\n"));
    pb.put("notes/c.md", file("c"));
    const task = (title: string, tags: string[], done?: string) => {
      const t = newTask(title.padEnd(15, "0"), { title, tags, ...(done ? { done } : {}) });
      pb.tasks.set(t.id, { ...t, rev: 1 });
    };
    task("fix tap", ["σπιτι"]); task("old", ["Σπίτι"], "2026-10-01"); task("report", ["work"]);
    type R = { notes: { path: string }[]; tasks: { title: string }[] };
    const any = await run(T.list_tagged, { tags: ["ΣΠΊΤΙ"] }) as R;
    expect(any.notes.map((n) => n.path)).toEqual(["notes/a.md"]);
    expect(any.tasks.map((t) => t.title)).toEqual(["fix tap"]);
    const both = await run(T.list_tagged, { tags: ["Σπίτι", "work"], match: "all" }) as R;
    expect(both.notes.map((n) => n.path)).toEqual(["notes/a.md"]);
    expect(both.tasks).toEqual([]);
    const done = await run(T.list_tagged, { tags: ["Σπίτι"], done: true }) as R;
    expect(done.tasks.map((t) => t.title).sort()).toEqual(["fix tap", "old"]);
  });
});

describe("search_notes", () => {
  it("every word, accents, tonos and case folded; title hits first; a plain snippet around the hit", async () => {
    pb.put("notes/a.md", file("Garage", "The door code is 1234.\n"));
    pb.put("notes/b.md", file("Ψώνια", "- γάλα\n- αυγά\n"));
    pb.put("notes/c.md", file("Misc", "the garage door sticks\n"));
    expect(await run(T.search_notes, { query: "ΓΑΛΑ" })).toEqual({ results: [{ path: "notes/b.md", title: "Ψώνια", snippet: "- γάλα - αυγά", match: "words" }] });
    const r = await run(T.search_notes, { query: "garage door" }) as { results: { path: string }[] };
    expect(r.results.map((h) => h.path)).toEqual(["notes/a.md", "notes/c.md"]);
    expect(await run(T.search_notes, { query: "nothing here" })).toEqual({ results: [] });
  });
  it("by meaning too, fused with the words: a note both find comes first", async () => {
    pb.put("notes/a.md", file("Service", "Toyota oil change\n"));
    pb.put("notes/b.md", file("Car", "the car's papers\n"));
    const r = await run(T.search_notes, { query: "car" }) as { results: { path: string; match: string }[] };
    expect(r.results.map((h) => [h.path, h.match])).toEqual([["notes/b.md", "both"], ["notes/a.md", "meaning"]]);
  });
});

describe("writes", () => {
  it("create_note: a new note at a free path, its columns copied out of the frontmatter", async () => {
    const r = await run(T.create_note, { title: "Garage door", body: "- 1234", pinned: true, tags: ["WORK"] }) as { saved: string };
    expect(r.saved).toMatch(/^notes\/\d{8}-garage-door\.md$/);
    const rec = pb.notes.get(r.saved)!;
    expect(rec).toMatchObject({ title: "Garage door", pinned: true, tags: ["work"], rev: 1 });
    expect(parseNote(r.saved, rec.text).body).toBe("- 1234\n");
    const again = await run(T.create_note, { title: "Garage door", body: "x" }) as { saved: string };
    expect(again.saved).toBe(r.saved.replace(/\.md$/, "-2.md"));
  });

  it("append_to_note: sends the rev it read; a write made meanwhile is re-read and the append redone on it", async () => {
    pb.put("notes/a.md", file("a", "- eggs\n"));
    let once = true;
    pb.meanwhile((rec) => { if (once) { once = false; rec.text = file("a", "- eggs\n- bread\n"); rec.rev++; } });
    expect(await run(T.append_to_note, { path: "notes/a.md", text: "milk" })).toMatchObject({ saved: "notes/a.md", rev: 3 });
    expect(parseNote("notes/a.md", pb.notes.get("notes/a.md")!.text).body).toBe("- eggs\n- bread\n- milk\n");
  });

  it("rewrite_note: merged with an edit made meanwhile, refused where they overlap", async () => {
    pb.put("notes/a.md", file("a", "one\ntwo\nthree\n"));
    let once = true;
    pb.meanwhile((rec) => { if (once) { once = false; rec.text = file("a", "one\ntwo\nthree\nfour\n"); rec.rev++; } });
    expect(await run(T.rewrite_note, { path: "notes/a.md", text: "ONE\ntwo\nthree", why: "caps" })).toMatchObject({ saved: "notes/a.md", rev: 3 });
    expect(parseNote("notes/a.md", pb.notes.get("notes/a.md")!.text).body).toBe("ONE\ntwo\nthree\nfour\n");

    once = true;
    pb.meanwhile((rec) => { if (once) { once = false; rec.text = file("a", "uno\ntwo\nthree\nfour\n"); rec.rev++; } });
    expect(await run(T.rewrite_note, { path: "notes/a.md", text: "1\ntwo\nthree\nfour", why: "x" })).toEqual({ error: expect.stringMatching(/changed meanwhile/) });
  });

  it("summarise_links: the route's block under each card without one, tainted; a failure listed", async () => {
    pb.put("notes/a.md", file("a", "[a](https://a.com)\nwhat it is\n\n- [b](https://b.com) inline\n\n[e](https://empty.com)\n"));
    const r = await run(T.summarise_links, { path: "notes/a.md" });
    expect(r).toMatchObject({ saved: "notes/a.md", summarised: 1, failed: ["https://empty.com"] });
    const n = pb.notes.get("notes/a.md")!;
    expect(parseNote("notes/a.md", n.text).body).toBe("[a](https://a.com)\n\n> **Summary**\n> About https://a.com.\n\nwhat it is\n\n- [b](https://b.com) inline\n\n[e](https://empty.com)\n");
    expect(n.tainted).toBe(true);
    expect(await run(T.summarise_links, { path: "notes/a.md", urls: ["https://a.com"] })).toMatchObject({ error: expect.stringContaining("No link card") });
  });

  it("set_note_flags: only existing tags, spelled as they exist", async () => {
    pb.put("notes/a.md", file("a"));
    expect(await run(T.set_note_flags, { path: "notes/a.md", tags: ["newtag", "work"] })).toEqual({ error: "Not an existing tag: newtag. Use only: Σπίτι, work." });
    expect(pb.notes.get("notes/a.md")!.rev).toBe(1);
    await run(T.set_note_flags, { path: "notes/a.md", tags: ["σπιτι", "WORK"], pinned: true });
    expect(pb.notes.get("notes/a.md")).toMatchObject({ tags: ["Σπίτι", "work"], pinned: true, rev: 2 });
  });

  it("set_note_flags: a tag typed on another note, never defined, is usable too", async () => {
    pb.put("notes/a.md", file("a"));
    pb.put("notes/b.md", file("b", "- x\n", "tags: [Ταξίδι]\n"));
    await run(T.set_note_flags, { path: "notes/a.md", tags: ["ταξιδι"] });
    expect(pb.notes.get("notes/a.md")).toMatchObject({ tags: ["Ταξίδι"], rev: 2 });
  });

  it("set_place: written at its rev, cleared again, and shown to the model by list_tasks", async () => {
    const added = await run(T.add_task, { title: "Swim" } as never) as { id: string };
    expect(await run(T.set_place, { task: added.id, name: "Pool" })).toMatchObject({ saved: "task", id: added.id, where: { name: "Pool" } });
    expect(pb.tasks.get(added.id)).toMatchObject({ where: { name: "Pool" }, rev: 2 });
    expect(JSON.stringify(await run(T.list_tasks, { view: "inbox" } as never))).toContain('"where":{"name":"Pool"}');
    await run(T.set_place, { task: added.id, clear: true });
    expect(pb.tasks.get(added.id)!.where).toBeNull();
    expect(await run(T.set_place, { task: "nope", name: "Pool" })).toMatchObject({ error: expect.stringContaining("No task nope") });
  });

  it("set_place: the confirm card is skipped only for a bad request, which goes back to the agent", async () => {
    const added = await run(T.add_task, { title: "Swim" } as never) as { id: string };
    const ask = approvals(notes, todo, false).set_place, o = { messages: [] as ModelMessage[] };
    expect(await ask({ task: added.id, name: "Home" }, o)).toBe("user-approval");
    expect(await ask({ task: added.id }, o)).toBe("not-applicable");
    expect(await ask({ task: "nope", name: "Home" }, o)).toBe("not-applicable");
  });

  it("update_memory: creates the file the first time, refuses one too long", async () => {
    expect(await run(T.update_memory, { text: "Writes in Greek.", why: "x" })).toEqual({ saved: "agent/memory.md", rev: 1 });
    expect(pb.notes.get("agent/memory.md")!.text).toBe("Writes in Greek.\n");
    expect(await run(T.update_memory, { text: "x".repeat(6001), why: "x" })).toEqual({ error: "Too long (6001 chars, max 6000). Condense and retry." });
  });

  it("appended: one line is one bullet, whether or not the agent wrote the marker", () => {
    expect(appended("- eggs\n", "milk")).toBe("- eggs\n- milk\n");
    expect(appended("- eggs\n", "- [ ] milk")).toBe("- eggs\n- [ ] milk\n");
    expect(appended("- eggs\n", "- one\n- two")).toBe("- eggs\n- one\n- two\n");
  });
});

describe("web taint", () => {
  it("marks a note the agent wrote with web text in view, in the same write; not one written without", async () => {
    pb.put("notes/a.md", file("a"));
    pb.put("notes/b.md", file("b"));
    await run(T.append_to_note, { path: "notes/a.md", text: "from a page" }, [web]);
    await run(T.append_to_note, { path: "notes/b.md", text: "typed" });
    expect(pb.notes.get("notes/a.md")).toMatchObject({ tainted: true, rev: 2 });
    expect(pb.notes.get("notes/b.md")).toMatchObject({ tainted: false, rev: 2 });
    expect(await notes.tainted()).toEqual(new Set(["notes/a.md"]));
  });
});

describe("tasks", () => {
  const TODAY = localDay(), tomorrow = localDay(Date.now() + 86_400_000);
  let n = 0;
  /** A task as a client would have written it. */
  const task = (title: string, o: Partial<Task> = {}): Task => {
    const t = newTask(`t${++n}`.padEnd(15, "0"), { title, order: n, ...o });
    pb.tasks.set(t.id, { ...t, rev: 1 });
    return t;
  };
  /** A link from a task to a note it is about, as a client would have made it. */
  const linkTo = (taskId: string, noteRec: string) => {
    const l = linkRecord(newLink(`l${++n}`.padEnd(15, "0"), { type: "task", id: taskId }, { type: "note", id: noteRec }, "about"));
    pb.links.set(l.id, { ...l, id: l.id });
    return l;
  };
  /** The note record ids a task is linked to, on the server. */
  const linkedTo = (taskId: string) => [...pb.links.values()].filter((l) => l.fromTask === taskId && l.role === "about").map((l) => l.toNote);
  const names = async (input: object) => ((await run(T.list_tasks, input as never)) as { tasks: { title: string }[] }).tasks.map((t) => t.title);

  it("list_tasks: Things' views over the records; what is set is all that is said", async () => {
    const note = pb.put("notes/a.md", file("Home"));
    linkTo(task("Plumber", { when: TODAY, remind: "09:00" }).id, note.id);
    task("Later", { when: "2999-01-01" });
    task("Loose");
    task("Book", { when: "2999-01-02", checklist: [{ id: "ab12", text: "passport", done: true }] });
    task("Old", { done: "2026-01-02" });
    expect(await names({ view: "today" })).toEqual(["Plumber"]);
    expect(await names({ view: "upcoming" })).toEqual(["Later", "Book"]);
    expect(await names({ view: "inbox" })).toEqual(["Loose"]);
    expect(await names({ view: "logbook" })).toEqual(["Old"]);
    const [plumber] = ((await run(T.list_tasks, { view: "today" } as never)) as { tasks: object[] }).tasks;
    expect(plumber).toEqual({ id: expect.any(String), title: "Plumber", when: TODAY, remind: "09:00", linked: ["notes/a.md"] });
    const [, book] = ((await run(T.list_tasks, { view: "upcoming" } as never)) as { tasks: object[] }).tasks;
    expect(book).toEqual({ id: expect.any(String), title: "Book", when: "2999-01-02", checklist: [{ id: "ab12", text: "passport", done: true }] });
  });

  it("add_task: a record under its own id at rev 1, checklist boxes with ids, after the last of its list", async () => {
    const r = await run(T.add_task, { title: "Buy milk", when: tomorrow, due: "2999-12-31", checklist: ["milk", "eggs"], notes: "Lidl" } as never) as { saved: string; id: string; rev: number };
    expect(r.id).toMatch(/^[a-z0-9]{15}$/);
    expect(r).toMatchObject({ saved: "task", rev: 1 });
    const rec = pb.tasks.get(r.id)!;
    expect(rec).toMatchObject({ title: "Buy milk", when: tomorrow, due: "2999-12-31", notes: "Lidl", done: "", order: 0 });
    expect(rec.checklist).toEqual([{ id: expect.stringMatching(/^[a-z0-9]{4}$/), text: "milk", done: false }, { id: expect.any(String), text: "eggs", done: false }]);
    const second = await run(T.add_task, { title: "Second" } as never) as { id: string };
    expect(pb.tasks.get(second.id)!.order).toBe(1);
    expect(pb.notes.size).toBe(0);                                              // nothing written into a note
  });

  it("add_task: linked to its notes; a bad note or value is an error", async () => {
    const note = pb.put("notes/a.md", file("A")), other = pb.put("notes/b.md", file("B"));
    const r = await run(T.add_task, { title: "Book", link: ["notes/a.md", "notes/b.md", "notes/a.md"] } as never) as { id: string };
    expect(pb.tasks.get(r.id)!.note).toBeUndefined();
    expect(linkedTo(r.id)).toEqual([note.id, other.id]);
    const none = (i: object) => run(T.add_task, { title: "x", ...i } as never);
    expect(await none({ link: ["notes/a.md", "notes/nope.md"] })).toEqual({ error: expect.stringMatching(/^No note notes\/nope.md/) });
    expect(await none({ link: ["agent/memory.md"] })).toEqual({ error: expect.stringMatching(/^No note/) });
    expect(await none({ when: "2026-02-31" })).toEqual({ error: expect.stringMatching(/^when: /) });
    expect(await none({ evening: true })).toEqual({ error: "evening needs a when." });
    expect(pb.tasks.size).toBe(1);
  });

  it("add_tasks: several records after the last task, in order, with checklists and one card list", async () => {
    task("Existing", { order: 4 });
    task("Elsewhere", { order: 9 });
    const r = await run(T.add_tasks, {
      tasks: [{ title: "Book flights", checklist: ["outbound", "return"], due: "2999-12-31" }, { title: "Pack" }, { title: "Insurance", notes: "ask Lidl" }],
    } as never) as { saved: string; ids: string[]; cards: { kind: string; title: string; checklist?: [number, number] }[] };
    expect(r.saved).toBe("tasks");
    expect(r.ids).toHaveLength(3);
    const recs = r.ids.map((id) => pb.tasks.get(id)!);
    expect(recs.map((x) => [x.title, x.order, x.rev])).toEqual([["Book flights", 10, 1], ["Pack", 11, 1], ["Insurance", 12, 1]]);
    expect(recs[0]).toMatchObject({ due: "2999-12-31", checklist: [{ text: "outbound", done: false }, { text: "return", done: false }] });
    expect(recs[2].notes).toBe("ask Lidl");
    expect(r.cards.map((c) => c.title)).toEqual(["Book flights", "Pack", "Insurance"]);
    expect(r.cards[0]).toMatchObject({ kind: "task", checklist: [0, 2] });
    expect(cardsOf(r)).toHaveLength(3);
    expect(pb.tasks.size).toBe(5);
  });

  it("add_tasks: one bad task writes nothing and the error names the task", async () => {
    const many = (i: object) => run(T.add_tasks, { tasks: [{ title: "ok" }], ...i } as never);
    expect(await many({ tasks: [{ title: "ok" }, { title: "bad", remind: "9am" }] })).toEqual({ error: expect.stringMatching(/^“bad”: remind: /) });
    expect(await many({ tasks: [{ title: "ok" }, { title: "late", evening: true }] })).toEqual({ error: "“late”: evening needs a when." });
    expect(pb.tasks.size).toBe(0);
    expect(await checkAddMany(notes, todo, { tasks: [{ title: "x" }] })).toBeNull();
    expect(await checkAddMany(notes, todo, { tasks: [{ title: "x" }, { title: "y", when: "2026-02-31" }] })).toMatch(/^“y”: when: /);
  });

  it("update_task: only what's passed changes, null clears, checklist ops by item id; a bad value or id is an error", async () => {
    const t = task("Call", { when: TODAY, due: "2999-01-01", remind: "09:00", checklist: [{ id: "aa11", text: "number", done: false }, { id: "aa12", text: "ask", done: false }] });
    expect(await run(T.update_task, { id: t.id, when: tomorrow, due: null, title: "Call plumber" } as never)).toMatchObject({ saved: "task", id: t.id, rev: 2 });
    expect(pb.tasks.get(t.id)).toMatchObject({ title: "Call plumber", when: tomorrow, due: "", remind: "09:00" });
    await run(T.update_task, { id: t.id, checklist: { set: [{ id: "aa11", done: true }, { id: "aa12", text: "ask about price" }], remove: [], add: ["pay"] } } as never);
    expect(pb.tasks.get(t.id)!.checklist).toEqual([{ id: "aa11", text: "number", done: true }, { id: "aa12", text: "ask about price", done: false }, { id: expect.any(String), text: "pay", done: false }]);
    await run(T.update_task, { id: t.id, checklist: { remove: ["aa11"] } } as never);
    expect(pb.tasks.get(t.id)!.checklist.map((i: { id: string }) => i.id)).toEqual(["aa12", expect.any(String)]);
    expect(await run(T.update_task, { id: t.id, every: "often" } as never)).toEqual({ error: expect.stringMatching(/^every: /) });
    expect(await run(T.update_task, { id: t.id, checklist: { remove: ["zzzz"] } } as never)).toEqual({ error: expect.stringMatching(/^No checklist item zzzz/) });
    expect(await run(T.update_task, { id: "nope" } as never)).toEqual({ error: expect.stringMatching(/^No task nope/) });
    expect(pb.tasks.get(t.id)!.rev).toBe(4);                                    // the refused ones wrote nothing
  });

  it("update_task: addNotes adds a paragraph after its notes; with notes it is refused", async () => {
    const t = task("Call", { notes: "Number: 210\n" });
    await run(T.update_task, { id: t.id, addNotes: "Ask about Friday." } as never);
    expect(pb.tasks.get(t.id)!.notes).toBe("Number: 210\n\nAsk about Friday.");
    expect(await run(T.update_task, { id: t.id, notes: "x", addNotes: "y" } as never)).toEqual({ error: expect.stringMatching(/not both/) });
  });

  it("tasks carry tags: only defined ones, spelled as defined; list_tasks says them", async () => {
    const r = await run(T.add_task, { title: "Fix tap", tags: ["WORK", "work", "σπιτι"] } as never) as { id: string; card: { tags?: string[] } };
    expect(pb.tasks.get(r.id)!.tags).toEqual(["work", "Σπίτι"]);
    expect(r.card.tags).toEqual(["work", "Σπίτι"]);
    expect(await run(T.add_task, { title: "x", tags: ["invented"] } as never)).toEqual({ error: expect.stringMatching(/^Not an existing tag: invented/) });
    expect(await run(T.add_tasks, { tasks: [{ title: "y", tags: ["nope"] }] } as never)).toEqual({ error: expect.stringMatching(/^“y”: Not an existing tag/) });
    const [t] = ((await run(T.list_tasks, { view: "inbox" } as never)) as { tasks: object[] }).tasks;
    expect(t).toMatchObject({ title: "Fix tap", tags: ["work", "Σπίτι"] });
  });

  it("update_task: addTags (defined ones) and removeTags (any it has) change the set, one rev", async () => {
    const t = task("Call", { tags: ["work", "old"] });
    expect(await run(T.update_task, { id: t.id, addTags: ["ΣΠΊΤΙ", "work"], removeTags: ["OLD"] } as never)).toMatchObject({ saved: "task", rev: 2 });
    expect(pb.tasks.get(t.id)!.tags).toEqual(["work", "Σπίτι"]);
    expect(await run(T.update_task, { id: t.id, addTags: ["invented"] } as never)).toEqual({ error: expect.stringMatching(/^Not an existing tag/) });
    expect(pb.tasks.get(t.id)!.rev).toBe(2);
  });

  it("update_task: link and unlink notes beside the task's own write; a link it has stays one; only links is a write", async () => {
    const a = pb.put("notes/a.md", file("A")), b = pb.put("notes/b.md", file("B")), t = task("Call");
    linkTo(t.id, a.id);
    const r = await run(T.update_task, { id: t.id, link: ["notes/a.md", "notes/b.md"] } as never);
    expect(r).toMatchObject({ saved: "task", id: t.id, rev: 1 });
    expect(r).not.toHaveProperty("unchanged");
    expect(linkedTo(t.id)).toEqual([a.id, b.id]);
    expect(await run(T.update_task, { id: t.id, unlink: ["notes/a.md"], title: "Call back" } as never)).toMatchObject({ rev: 2 });
    expect(linkedTo(t.id)).toEqual([b.id]);
    expect(await run(T.update_task, { id: t.id, unlink: ["notes/a.md"] } as never)).toMatchObject({ saved: "task" });     // not linked: nothing to do
    expect(await run(T.update_task, { id: t.id, link: ["notes/nope.md"] } as never)).toEqual({ error: expect.stringMatching(/^No note/) });
    const [listed] = ((await run(T.list_tasks, { view: "inbox" } as never)) as { tasks: object[] }).tasks;
    expect(listed).toMatchObject({ title: "Call back", linked: ["notes/b.md"] });
  });

  it("update_task: a write made meanwhile is kept, the edit redone on it", async () => {
    const t = task("Do", { checklist: [{ id: "aa11", text: "x", done: false }] });
    let once = true;
    pb.meanwhile((rec) => { if (once && rec.id === t.id) { once = false; rec.checklist = [{ id: "aa11", text: "x", done: true }]; rec.rev++; } });
    expect(await run(T.update_task, { id: t.id, notes: "hello" } as never)).toMatchObject({ saved: "task", id: t.id, rev: 3 });
    expect(pb.tasks.get(t.id)).toMatchObject({ notes: "hello", checklist: [{ id: "aa11", text: "x", done: true }] });
  });

  it("complete_task: ticked with the day; a repeating one gets its next round as a new record; a tick is not done twice", async () => {
    const t = task("Bins", { when: TODAY, every: "1w", checklist: [{ id: "aa11", text: "x", done: true }] }), note = pb.put("notes/a.md", file("A"));
    linkTo(t.id, note.id);
    const r = await run(T.complete_task, { id: t.id } as never) as { next: string };
    expect(linkedTo(r.next)).toEqual([note.id]);                              // the next round is about the same note
    expect(linkedTo(t.id)).toEqual([note.id]);
    expect(pb.tasks.get(t.id)).toMatchObject({ done: TODAY, every: "", when: TODAY, rev: 2 });
    const next = pb.tasks.get(r.next)!;
    expect(next).toMatchObject({ title: "Bins", every: "1w", done: "", rev: 1, checklist: [{ id: "aa11", text: "x", done: false }] });
    expect(next.when > TODAY).toBe(true);
    expect(pb.tasks.size).toBe(2);
    expect(await run(T.complete_task, { id: t.id } as never)).toMatchObject({ saved: "task", id: t.id, rev: 2, unchanged: true });
    await run(T.complete_task, { id: t.id, done: false } as never);
    expect(pb.tasks.get(t.id)).toMatchObject({ done: "", rev: 3 });
    expect(pb.tasks.size).toBe(2);
    expect(await run(T.complete_task, { id: "zzzz" } as never)).toEqual({ error: expect.stringMatching(/^No task zzzz/) });
  });

  it("complete_task: a write made meanwhile is kept, and a retried tick makes one next round", async () => {
    const t = task("Bins", { when: TODAY, every: "1w" }), other = task("Other");
    let once = true;
    pb.meanwhile((rec) => { if (once && rec.id === t.id) { once = false; rec.notes = "by the door"; rec.rev++; } });
    await run(T.complete_task, { id: t.id } as never);
    expect(pb.tasks.get(t.id)).toMatchObject({ done: TODAY, notes: "by the door", rev: 3 });
    expect(pb.tasks.size).toBe(3);
    expect(pb.tasks.get(other.id)!.rev).toBe(1);
  });

  it("list_tasks: a query finds a task by any of its words, folded; a tag narrows; open and all span every day", async () => {
    task("Αγορά γάλακτος", { notes: "από το περίπτερο" });
    task("Call the plumber", { when: tomorrow, tags: ["Σπίτι"] });
    task("Old report", { done: TODAY });
    expect(await names({ view: "open", query: "αγορα περιπτερο" })).toEqual(["Αγορά γάλακτος"]);
    expect(await names({ view: "open", tag: "σπίτι" })).toEqual(["Call the plumber"]);
    expect(await names({ view: "open", query: "report" })).toEqual([]);
    expect(await names({ view: "all", query: "report" })).toEqual(["Old report"]);
  });

  it("delete_task: gone on the rev it read; no such task is an error", async () => {
    const t = task("Old");
    expect(await run(T.delete_task, { id: t.id } as never)).toEqual({ saved: "task", id: t.id, rev: 1 });
    expect(pb.tasks.size).toBe(0);
    expect(await run(T.delete_task, { id: t.id } as never)).toEqual({ error: expect.stringMatching(/^No task/) });
  });

  it("a double booking is refused until the user says to book it anyway", async () => {
    const day = "2999-03-04", t = task("Dentist", { when: day, remind: "10:00" }), u = task("Gym", { when: day, remind: "12:00" });
    expect(await checkAdd(notes, todo, { title: "Call", when: day, remind: "10:30" })).toMatch(/^Double booking: .*“Dentist” at 10:00/);
    expect(await checkAdd(notes, todo, { title: "Call", when: day, remind: "11:00" })).toBeNull();
    expect(await checkAdd(notes, todo, { title: "Call", when: day })).toBeNull();
    expect(await checkAdd(notes, todo, { title: "Call", when: day, remind: "10:30", overlap: true })).toBeNull();
    expect(await checkAddMany(notes, todo, { tasks: [{ title: "a", when: day, remind: "15:00" }, { title: "b", when: day, remind: "15:15" }] })).toMatch(/^“b”: Double booking: .*“a”/);
    expect(await checkUpdate(notes, todo, { id: u.id, remind: "10:45" })).toMatch(/^Double booking/);
    expect(await checkUpdate(notes, todo, { id: u.id, remind: "10:45", overlap: true })).toBeNull();
    expect(await checkUpdate(notes, todo, { id: t.id, title: "Dentist (Dr. A)" })).toBeNull();
    expect(await run(T.add_task, { title: "Call", when: day, remind: "10:05" } as never)).toEqual({ error: expect.stringMatching(/^Double booking/) });
    expect(pb.tasks.size).toBe(2);
  });

  it("checks run before a card: note, task and values", async () => {
    const t = task("Call");
    expect(await checkAdd(notes, todo, { title: "x" })).toBeNull();
    expect(await checkAdd(notes, todo, { title: "x", link: ["notes/nope.md"] })).toMatch(/^No note/);
    expect(await checkAdd(notes, todo, { title: "x", remind: "9am" })).toMatch(/^remind: /);
    expect(await checkUpdate(notes, todo, { id: t.id, when: "2999-01-01" })).toBeNull();
    expect(await checkUpdate(notes, todo, { id: "nope" })).toMatch(/^No task nope/);
    expect(await checkUpdate(notes, todo, { id: t.id, evening: true })).toBe("evening needs a when.");
    expect(await checkTask(todo, t.id)).toBeNull();
    expect(await checkTask(todo, "nope")).toMatch(/^No task nope/);
  });
});

describe("delete_note", () => {
  it("gone on the rev it read; a write meanwhile is deleted too; the memory file and a missing note are refused", async () => {
    pb.notes.set("notes/a.md", { id: "r1", path: "notes/a.md", rev: 1, tainted: false, updated: "2026-10-05 10:00:00.000Z", text: file("A"), title: "A", tags: [] });
    let once = true;
    pb.meanwhile((rec) => { if (once && rec.id === "r1") { once = false; rec.rev++; } });
    expect(await run(T.delete_note, { path: "notes/a.md" })).toEqual({ deleted: "notes/a.md", rev: 2 });
    expect(pb.notes.size).toBe(0);
    expect(await run(T.delete_note, { path: "notes/a.md" })).toEqual({ error: expect.stringMatching(/^No note/) });
    expect(await run(T.delete_note, { path: "agent/memory.md" })).toEqual({ error: expect.stringMatching(/^Not a note path/) });
  });

  it("always asks, whatever the setting; a bad path goes straight back", async () => {
    pb.notes.set("notes/a.md", { id: "r1", path: "notes/a.md", rev: 1, tainted: false, updated: "2026-10-05 10:00:00.000Z", text: file("A"), title: "A", tags: [] });
    const ask = approvals(notes, todo, true);
    expect(await ask.delete_note({ path: "notes/a.md" })).toBe("user-approval");
    expect(await ask.delete_note({ path: "notes/zz.md" })).toBe("not-applicable");
  });
});

describe("cards", () => {
  const out = (x: unknown) => cardsOf(x);
  it("a note write leaves the note's card: title, tags, opening lines, photo; the memory file has none", async () => {
    pb.notes.set("notes/20261005-a.md", { id: "r1", path: "notes/20261005-a.md", rev: 1, tainted: false, updated: "2026-10-05 10:00:00.000Z",
      text: file("Trip", "# Trip\nline one\n![x](../attachments/20261005-a/p1.jpg)\n", "tags: [work]\n"), title: "Trip", tags: ["work"] });
    const r = await run(T.append_to_note, { path: "notes/20261005-a.md", text: "milk" });
    expect(out(r)).toEqual([{ kind: "note", path: "notes/20261005-a.md", title: "Trip", tags: ["work"], image: "p1.jpg",
      preview: "line one\n\n- milk" }]);
    const made = await run(T.create_note, { title: "Garage", body: "- 1234", tags: ["work"] });
    expect(out(made)).toEqual([{ kind: "note", path: expect.stringMatching(/^notes\/\d{8}-garage\.md$/), title: "Garage", tags: ["work"], preview: "- 1234" }]);
    const flags = await run(T.set_note_flags, { path: "notes/20261005-a.md", pinned: true });
    expect(out(flags)[0]).toMatchObject({ kind: "note", title: "Trip" });
    expect(out(await run(T.update_memory, { text: "Writes in Greek.", why: "x" }))).toEqual([]);
  });

  it("a task write leaves its card; a delete none", async () => {
    const added = await run(T.add_task, { title: "Book flights", due: "2999-12-31", checklist: ["a", "b"] } as never) as { id: string };
    expect(out(added)).toEqual([{ kind: "task", id: added.id, title: "Book flights", due: "2999-12-31", checklist: [0, 2] }]);
    expect(out(await run(T.update_task, { id: added.id, when: "2026-11-02", evening: true } as never))[0]).toMatchObject({ when: "2026-11-02", evening: true });
    expect(out(await run(T.complete_task, { id: added.id } as never))[0]).toMatchObject({ id: added.id, done: localDay() });
    expect(out(await run(T.delete_task, { id: added.id } as never))).toEqual([]);
  });

  it("show_items: the cards of what was asked for, once each, from the server's copy; the model gets titles and ids only", async () => {
    pb.put("notes/a.md", file("Alpha", "body of alpha\n"));
    const t = await todo.addTask({ title: "Pack" }) as { id: string };
    const r = await run(T.show_items, { items: [{ kind: "note", ref: "notes/a.md" }, { kind: "task", ref: t.id },
      { kind: "note", ref: "notes/a.md" }, { kind: "note", ref: "notes/nope.md" }, { kind: "note", ref: "agent/memory.md" }] });
    expect(out(r)).toEqual([
      { kind: "note", path: "notes/a.md", title: "Alpha", preview: "body of alpha" },
      { kind: "task", id: t.id, title: "Pack" }]);
    expect(r).toMatchObject({ not_found: ["notes/nope.md", "agent/memory.md"] });
    const model = await T.show_items.toModelOutput!({ toolCallId: "c", input: {} as never, output: r as never });
    expect(model).toEqual({ type: "json", value: { shown: [{ path: "notes/a.md", title: "Alpha" }, { kind: "task", id: t.id, title: "Pack" }],
      not_found: ["notes/nope.md", "agent/memory.md"] } });
    expect(await run(T.show_items, { items: [{ kind: "task", ref: "zzz" }] })).toEqual({ error: expect.stringMatching(/^Nothing found for zzz/) });
  });

  it("show_items asks for no confirmation and a tainted note it shows counts as the web read", async () => {
    pb.put("notes/w.md", file("From the web"));
    pb.notes.get("notes/w.md")!.tainted = true;
    const web = readWeb(notes, todo);
    const r = await run(T.show_items, { items: [{ kind: "note", ref: "notes/w.md" }] });
    const model = await T.show_items.toModelOutput!({ toolCallId: "c", input: {} as never, output: r as never });
    const result: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "show_items", output: model }] };
    expect(await web([result])).toBe(true);
    expect(Object.keys(approvals(notes, todo, false))).not.toContain("show_items");
  });
});

describe("approvals", () => {
  const readOf = (path: string): ModelMessage =>
    ({ role: "tool", content: [{ type: "tool-result", toolCallId: "r", toolName: "read_note", output: { type: "json", value: { path, text: "x" } } }] });
  const o = (messages: ModelMessage[] = []) => ({ messages });

  it("a write asks, unless writes without asking are on and the chat hasn't read the web; a bad path skips the card", async () => {
    pb.put("notes/a.md", file("a"));
    const ask = approvals(notes, todo, false), auto = approvals(notes, todo, true);
    expect(await ask.append_to_note({ path: "notes/a.md" }, o())).toBe("user-approval");
    expect(await ask.append_to_note({ path: "notes/nope.md" }, o())).toBe("not-applicable");
    expect(await ask.rewrite_note({ path: "notes/a.md", text: "---\nx\n" }, o())).toBe("not-applicable");
    expect(await auto.create_note({}, o())).toBe("not-applicable");
    expect(await auto.append_to_note({ path: "notes/a.md" }, o([web]))).toBe("user-approval");
  });

  it("a task write asks like a note write; a bad task or value skips the card; a delete always asks; list_tasks never asks", async () => {
    const t = newTask("ff11".padEnd(15, "0"), { title: "Call" });
    pb.tasks.set(t.id, { ...t, rev: 1 });
    const ask = approvals(notes, todo, false), auto = approvals(notes, todo, true);
    expect(await ask.add_task({ title: "x" }, o())).toBe("user-approval");
    expect(await ask.update_task({ id: t.id, when: "2999-01-01" }, o())).toBe("user-approval");
    expect(await ask.complete_task({ id: t.id }, o())).toBe("user-approval");
    expect(await ask.add_tasks({ tasks: [{ title: "x" }] }, o())).toBe("user-approval");
    expect(await ask.add_tasks({ tasks: [{ title: "x", remind: "9am" }] }, o())).toBe("not-applicable");
    expect(await auto.add_tasks({ tasks: [{ title: "x" }] }, o([web]))).toBe("user-approval");
    expect(await ask.complete_task({ id: "zzzz" }, o())).toBe("not-applicable");
    expect(await ask.update_task({ id: t.id, when: "soon" }, o())).toBe("not-applicable");
    expect(await ask.add_task({ title: "x", link: ["notes/nope.md"] }, o())).toBe("not-applicable");
    expect(await auto.add_task({ title: "x" }, o())).toBe("not-applicable");
    expect(await auto.update_task({ id: t.id, notes: "n" }, o())).toBe("not-applicable");
    expect(await auto.add_task({ title: "x" }, o([web]))).toBe("user-approval");
    expect(await auto.complete_task({ id: t.id }, o([web]))).toBe("user-approval");
    expect(await auto.delete_task({ id: t.id })).toBe("user-approval");
    expect(await auto.delete_task({ id: "zzzz" })).toBe("not-applicable");
    expect("list_tasks" in ask).toBe(false);
  });

  it("a tainted note a task is about, read through list_tasks, counts as reading the web", async () => {
    const w = pb.put("notes/w.md", file("w"), { tainted: true });
    const t = newTask("ab12".padEnd(15, "0"), { title: "t" });
    pb.tasks.set(t.id, { ...t, rev: 1 });
    const listed: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "l", toolName: "list_tasks", output: { type: "json", value: { tasks: [{ linked: ["notes/w.md"] }] } } }] };
    expect(await approvals(notes, todo, true).complete_task({ id: t.id }, o([listed]))).toBe("user-approval");
  });

  it("marks a task written with web text in view, in the same write; read back, it counts as the web", async () => {
    const a = await run(T.add_task, { title: "From a page" } as never, [web]) as { id: string };
    const b = await run(T.add_task, { title: "Typed" } as never) as { id: string };
    expect(pb.tasks.get(a.id)).toMatchObject({ tainted: true, rev: 1 });
    expect(pb.tasks.get(b.id)?.tainted).toBeUndefined();
    await run(T.update_task, { id: b.id, about: "Typed", notes: "a page's words" } as never, [web]);
    expect(pb.tasks.get(b.id)).toMatchObject({ tainted: true, rev: 2 });
    expect(await todo.tainted()).toEqual(new Set([a.id, b.id]));
    const listed: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "l", toolName: "list_tasks", output: { type: "json", value: { tasks: [{ id: a.id }] } } }] };
    expect(await approvals(notes, todo, true).add_task({ title: "x" }, o([listed]))).toBe("user-approval");
  });

  it("memory without a card, unless the chat read the web or a note written from it", async () => {
    pb.put("notes/w.md", file("w"), { tainted: true });
    const a = approvals(notes, todo, true);
    expect(await a.update_memory({ text: "x" }, o())).toBe("not-applicable");
    expect(await a.update_memory({ text: "x" }, o([web]))).toBe("user-approval");
    expect(await a.update_memory({ text: "x" }, o([readOf("notes/w.md")]))).toBe("user-approval");
    expect(await a.update_memory({ text: "x".repeat(6001) }, o([web]))).toBe("not-applicable");   // its own error, straight back
  });
});


describe("tag definitions", () => {
  it("creates a definition, lists its editable id, and makes it usable on notes", async () => {
    const made = await run(T.create_tag, { name: "travel", color: "blue", description: "Trips" });
    expect(made).toMatchObject({ tag: { name: "travel", color: "blue", description: "Trips" } });
    expect(await run(T.list_tags, {})).toMatchObject({ tags: expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: "travel", means: "Trips" })]) });
    expect(await run(T.create_note, { title: "Trip", body: "Packing", tags: ["travel"] })).toHaveProperty("saved");
    expect(await run(T.create_tag, { name: "TRAVEL" })).toHaveProperty("error");
  });
  it("updates only supplied fields, clears optional fields, and leaves assigned names alone", async () => {
    pb.put("notes/a.md", file("A", "Body", "tags: [work]\n"));
    expect(await run(T.update_tag, { id: "t2", color: "green", description: "Work projects" })).toMatchObject({ tag: { name: "work", color: "green", description: "Work projects" } });
    expect(await run(T.update_tag, { id: "t2", name: "office" })).toMatchObject({ tag: { name: "office", color: "green", description: "Work projects" } });
    expect(parseNote("notes/a.md", (await notes.read("notes/a.md"))!.text).tags).toEqual(["work"]);
    expect(await run(T.update_tag, { id: "t2", color: null, description: "" })).toMatchObject({ tag: { color: undefined, description: "" } });
    expect(await run(T.update_tag, { id: "missing", name: "x" })).toHaveProperty("error");
    expect(await run(T.update_tag, { id: "t2" })).toHaveProperty("error");
  });
  it("asks before tag writes, including after reading web content with cards off", async () => {
    for (const name of ["create_tag", "update_tag"] as const) {
      expect(await approvals(notes, todo, false)[name]({}, { messages: [] })).toBe("user-approval");
      expect(await approvals(notes, todo, true)[name]({}, { messages: [] })).toBe("not-applicable");
      expect(await approvals(notes, todo, true)[name]({}, { messages: [web] })).toBe("user-approval");
    }
  });
});
