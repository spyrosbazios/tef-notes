// The native companion's feeds (src/companion.ts): rows worked out here, so a companion only draws them.
import { describe, expect, it } from "bun:test";
import { choices, describe as describeResult, summaryNotice, type ClipResult, type Suggestions } from "../src/clip";
import { DEFAULT_LOOK, FEED_LIMITS, helloOf, newTaskOf, notesFeed, ownerLook, shareClip, taskListOf, tasksFeed, type NoteRow, type ShareIn } from "../src/companion";
import type { Lens } from "../src/lens";
import { serializeNote } from "../src/notes";
import { fit, lookSize } from "../src/photos";
import { DEFAULT_PREFS } from "../src/prefs";
import { ACCENTS, THEMES } from "../src/theme";
import { newTask, type Task } from "../src/todo";
import cases from "./companion-cases.json";

const TODAY = "2026-11-14";
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...newTask(id, { title: `Task ${id}`, order: 0 }), ...fields });
const work: Lens = { rec: "w", name: "Work", tags: ["work"], exclude: [], accent: "teal", theme: "light" };
const feed = (tasks: Task[], list: "today" | "inbox" | "upcoming", lens: Lens | null = null) => tasksFeed(tasks, list, TODAY, lens, DEFAULT_LOOK);

describe("the look", () => {
  it("is the owner's theme and accent, the lens's over them", () => {
    expect(DEFAULT_LOOK).toEqual({ scheme: THEMES.oled.scheme, ...THEMES.oled.C });
    expect(ownerLook({ theme: "nord", accent: "rose" }, null)).toMatchObject({ scheme: "dark", bg: THEMES.nord.C.bg, brand: ACCENTS.rose.dark });
    expect(ownerLook({ theme: "nord", accent: "rose" }, work)).toMatchObject({ scheme: "light", bg: THEMES.light.C.bg, brand: ACCENTS.teal.light });
  });
  it("hello names the app, the contract and the summary box as left", () => {
    expect(helloOf({ ...DEFAULT_PREFS, clip: { summary: true } }, null)).toEqual({ app: "tefnotes", contract: 1, look: DEFAULT_LOOK, summary: true, tag: null });
    expect(helloOf(DEFAULT_PREFS, work).tag).toBe("work");
  });
});

describe("a task list", () => {
  it("Today: the day's tasks, then This Evening's, each opening in the web app", () => {
    const f = feed([
      task("a", { when: TODAY, remind: "09:30", order: 2 }),
      task("b", { when: TODAY, evening: true, order: 1 }),
      task("c", { due: "2026-11-12", order: 3 }),
      task("d", { when: "2026-11-20" }),
      task("e", { when: TODAY, done: TODAY }),
    ], "today");
    expect(f).toMatchObject({ contract: 1, list: "today", title: "Today", url: "/today", more: 0 });
    expect(f.sections).toEqual([
      { label: "", tasks: [
        { id: "a", title: "Task a", detail: "09:30", late: false, url: "/today?t=a" },
        { id: "c", title: "Task c", detail: "Due Nov 12", late: true, url: "/today?t=c" },
      ] },
      { label: "This Evening", tasks: [{ id: "b", title: "Task b", detail: "", late: false, url: "/today?t=b" }] },
    ]);
  });
  it("says what is due today and how far a checklist is", () => {
    const t = task("a", { when: TODAY, due: TODAY, checklist: [{ id: "1", text: "x", done: true }, { id: "2", text: "y", done: false }] });
    expect(feed([t], "today").sections[0].tasks[0].detail).toBe("Due today · 1/2");
  });
  it("the Inbox whole, Upcoming a section a day", () => {
    const tasks = [task("a"), task("b", { when: "2026-11-15" }), task("c", { when: "2026-11-21" })];
    expect(feed(tasks, "inbox").sections).toEqual([{ label: "", tasks: [expect.objectContaining({ id: "a" })] }]);
    expect(feed(tasks, "upcoming").sections.map((s) => [s.label, s.tasks.map((t) => t.id)])).toEqual([["Tomorrow · Nov 15", ["b"]], ["Nov 21 · Saturday", ["c"]]]);
  });
  it("is seen through the lens on, which the title names", () => {
    const f = feed([task("a", { tags: ["Work"] }), task("b")], "inbox", work);
    expect(f.title).toBe("Inbox · Work");
    expect(f.sections[0].tasks.map((t) => t.id)).toEqual(["a"]);
  });
  it("cuts at the limit from the top and counts the rest", () => {
    const many = Array.from({ length: FEED_LIMITS.tasks + 3 }, (_, i) => task(`t${i}`, { order: i }));
    const f = feed([...many, task("eve", { when: TODAY, evening: true })], "inbox");
    expect(f.sections[0].tasks).toHaveLength(FEED_LIMITS.tasks);
    expect(f.more).toBe(3);
    expect(feed([], "today").sections).toEqual([]);
  });
  it("reads a list's name, Today when it is none", () => {
    expect(taskListOf("upcoming")).toBe("upcoming");
    expect(taskListOf("logbook")).toBe("today");
  });
});

describe("a new task", () => {
  it("takes a title on one line and the list it was added from", () => {
    expect(newTaskOf({ title: "  Buy\n milk ", list: "today" })).toEqual({ title: "Buy milk", list: "today" });
    expect(newTaskOf({ title: "x", list: "upcoming" })).toEqual({ title: "x", list: "inbox" });
  });
  it("is nothing without a title", () => {
    expect(newTaskOf({ title: "  " })).toBeNull();
    expect(newTaskOf(null)).toBeNull();
  });
});

describe("the notes", () => {
  const row = (id: string, p: Partial<NoteRow> & { body?: string; color?: "blue" } = {}): NoteRow => ({
    path: `notes/${id}.md`, text: serializeNote({ title: `Note ${id}`, created: "2026-11-01", tags: [...(p.tags ?? [])], ...(p.color ? { color: p.color } : {}) }, p.body ?? ""),
    tags: p.tags ?? [], pinned: p.pinned ?? false, archived: p.archived ?? false, updated: p.updated ?? 0,
  });
  it("pinned first, then the latest; no archived note, nor the memory file", () => {
    const f = notesFeed([row("old", { updated: 1 }), row("new", { updated: 5 }), row("pin", { pinned: true }), row("gone", { archived: true, updated: 9 }),
      { ...row("memory"), path: "memory.md" }], null, DEFAULT_PREFS);
    expect(f.notes.map((n) => n.id)).toEqual(["pin", "new", "old"]);
    expect(f).toMatchObject({ title: "Notes", url: "/notes", more: 0, look: DEFAULT_LOOK });
  });
  it("a row peeks at the body as plain text and opens the note", () => {
    const [n] = notesFeed([row("a", { body: "# Heading\n\nSome **bold** words and a [link](https://x.y).\n", color: "blue" })], null, DEFAULT_PREFS).notes;
    expect(n).toEqual({ id: "a", title: "Note a", peek: "Some bold words and a link.", pinned: false, url: "/note/a", color: THEMES.oled.NOTE_COLORS.blue });
  });
  it("is seen through the lens, in its theme", () => {
    const f = notesFeed([row("a", { tags: ["work"], color: "blue" }), row("b")], work, DEFAULT_PREFS);
    expect(f.title).toBe("Notes · Work");
    expect(f.notes.map((n) => [n.id, n.color])).toEqual([["a", THEMES.light.NOTE_COLORS.blue]]);
  });
});

// What a companion holds a copy of, in its own language: both copies are run over test/companion-cases.json (android's:
// android/app/src/test/kotlin/app/tefnotes/companion/CasesTest.kt).
describe("the rules a companion copies", () => {
  for (const c of cases.share as { name: string; in: ShareIn; clip: unknown }[])
    it(`a share as a clip: ${c.name}`, () => expect(shareClip(c.in)).toEqual(c.clip as ReturnType<typeof shareClip>));

  it("the picture stored: long edge 1600, never enlarged", () => {
    for (const c of cases.stored) {
      const to = fit(c.width, c.height), k = !to ? 1 : "width" in to ? to.width / c.width : to.height / c.height;
      expect({ width: Math.round(c.width * k), height: Math.round(c.height * k) }).toEqual(c.size);
    }
  });
  it("the picture JEV looks at", () => {
    for (const c of cases.look) expect(lookSize(c.width, c.height)).toEqual(c.size);
  });
  for (const c of cases.choices as unknown as { name: string; suggestions: Suggestions; picture: boolean; choices: unknown }[])
    it(`the choices: ${c.name}`, () => expect(choices(c.suggestions, c.picture)).toEqual(c.choices as ReturnType<typeof choices>));
  it("what a save says", () => {
    for (const c of cases.results as unknown as { result: ClipResult; line: string; notice: string | null }[]) {
      expect(describeResult(c.result)).toBe(c.line);
      expect(summaryNotice(c.result)).toBe(c.notice);
    }
  });
});
