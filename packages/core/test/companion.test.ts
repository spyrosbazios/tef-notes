// The native companion's feeds (src/companion.ts): rows worked out here, so a companion only draws them.
import { describe, expect, it } from "bun:test";
import { choices, CLIP_FILES, describe as describeResult, filesWord, summaryNotice, unpickedTags, type ClipResult, type ClipTags, type Suggestions } from "../src/clip";
import { COMPANION_CONTRACT, DEFAULT_LOOK, hex8, FEED_LIMITS, helloOf, lensPickOf, newTaskOf, notesFeed, ownerLook, shareClip, switchesOf, taskListOf, tasksFeed, type FeedNoteSource, type ShareIn } from "../src/companion";
import type { Lens } from "../src/lens";
import { serializeNote } from "../src/notes";
import { LOOK_QUALITY, lookSize, MAX_PDF, QUALITY, storedSize } from "../src/photos";
import { DEFAULT_PREFS, OPENING_LISTS } from "../src/prefs";
import { TASK_LIST_LABEL } from "../src/things";
import { ACCENTS, THEMES } from "../src/theme";
import { newTask, type Task } from "../src/todo";
import cases from "./companion-cases.json";

const TODAY = "2026-11-14";
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...newTask(id, { title: `Task ${id}`, order: 0 }), ...fields });
const work: Lens = { rec: "w", name: "Work", tags: ["work"], exclude: [], accent: "teal", theme: "light" };
const feed = (tasks: Task[], list: "today" | "inbox" | "upcoming", lens: Lens | null = null) => tasksFeed(tasks, list, TODAY, [work], lens, DEFAULT_LOOK);

describe("the look", () => {
  it("is the owner's theme and accent, the lens's over them", () => {
    expect(DEFAULT_LOOK).toEqual({ scheme: THEMES.oled.scheme, ...THEMES.oled.C, muted: "#f1f1f512", soft: "#b39bff1a", scrim: "#0000008c" });
    expect(hex8("rgba(255, 0, 16, 1)")).toBe("#ff0010ff");
    expect(() => hex8("#fff")).toThrow();
    expect(ownerLook({ theme: "nord", accent: "rose" }, null)).toMatchObject({ scheme: "dark", bg: THEMES.nord.C.bg, brand: ACCENTS.rose.dark });
    expect(ownerLook({ theme: "nord", accent: "rose" }, work)).toMatchObject({ scheme: "light", bg: THEMES.light.C.bg, brand: ACCENTS.teal.light });
  });
  it("hello names the app, the contract and the summary box as left", () => {
    expect(helloOf({ ...DEFAULT_PREFS, clip: { summary: true } }, null)).toEqual({ app: "tefnotes", contract: 4, look: DEFAULT_LOOK, summary: true });
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
    expect(f).toMatchObject({ contract: 4, list: "today", title: "Today", url: "/today", more: 0 });
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
  const id = "abcdefghij01234";
  it("takes a title on one line, the list it was added from and the id the companion made", () => {
    expect(newTaskOf({ id, title: "  Buy\n milk ", list: "today" })).toEqual({ id, title: "Buy milk", list: "today" });
    expect(newTaskOf({ id, title: "x", list: "upcoming" })).toEqual({ id, title: "x", list: "inbox" });
  });
  it("is nothing without a title, or without an id of a record id's shape: a repeat must be the same task", () => {
    expect(newTaskOf({ id, title: "  " })).toBeNull();
    expect(newTaskOf(null)).toBeNull();
    expect(newTaskOf({ title: "Buy milk" })).toBeNull();
    for (const bad of ["short", "ABCDEFGHIJ01234", "abcdefghij012345", 7, null]) expect(newTaskOf({ id: bad, title: "Buy milk" })).toBeNull();
  });
});

describe("what a heading offers", () => {
  it("the lenses to turn on, none first and the one on marked; nothing to switch with no lens defined", () => {
    expect(switchesOf([work], null)).toEqual({ lenses: [{ id: "", name: "No lens", on: true }, { id: "w", name: "Work", on: false }], ask: "/?ask=1" });
    expect(switchesOf([work], work).lenses.map((l) => l.on)).toEqual([false, true]);
    expect(switchesOf([], null).lenses).toEqual([]);
    expect(feed([], "today", work).lenses).toHaveLength(2);
  });
  it("a pick is a lens's id, or none", () => {
    expect(lensPickOf({ lens: "w" })).toBe("w");
    expect(lensPickOf({ lens: "" })).toBe("");
    expect(lensPickOf({ lens: null })).toBe("");
    expect(lensPickOf({})).toBeNull();
    expect(lensPickOf("w")).toBeNull();
  });
});

describe("the notes", () => {
  const row = (id: string, p: Partial<FeedNoteSource> & { body?: string; color?: "blue" } = {}): FeedNoteSource => ({
    path: `notes/${id}.md`, text: serializeNote({ title: `Note ${id}`, created: "2026-11-01", tags: [...(p.tags ?? [])], ...(p.color ? { color: p.color } : {}) }, p.body ?? ""),
    tags: p.tags ?? [], pinned: p.pinned ?? false, archived: p.archived ?? false, updated: p.updated ?? 0,
  });
  it("pinned first, then the latest; no archived note, nor the memory file", () => {
    const f = notesFeed([row("old", { updated: 1 }), row("new", { updated: 5 }), row("pin", { pinned: true }), row("gone", { archived: true, updated: 9 }),
      { ...row("memory"), path: "memory.md" }], [], null, DEFAULT_PREFS);
    expect(f.notes.map((n) => n.id)).toEqual(["pin", "new", "old"]);
    expect(f).toMatchObject({ title: "Notes", url: "/notes", more: 0, look: DEFAULT_LOOK, lenses: [], ask: "/?ask=1" });
  });
  it("a row peeks at the body as plain text and opens the note", () => {
    const [n] = notesFeed([row("a", { body: "# Heading\n\nSome **bold** words and a [link](https://x.y).\n", color: "blue" })], [], null, DEFAULT_PREFS).notes;
    expect(n).toEqual({ id: "a", title: "Note a", peek: "Some bold words and a link.", pinned: false, url: "/note/a", color: THEMES.oled.NOTE_COLORS.blue });
  });
  it("is seen through the lens, in its theme", () => {
    const f = notesFeed([row("a", { tags: ["work"], color: "blue" }), row("b")], [work], work, DEFAULT_PREFS);
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
    for (const c of cases.stored) expect(storedSize(c.width, c.height)).toEqual(c.size);
  });
  it("the picture JEV looks at", () => {
    for (const c of cases.look) expect(lookSize(c.width, c.height)).toEqual(c.size);
  });
  it("the limits on a clip's files", () => expect({ files: CLIP_FILES, pdf: MAX_PDF }).toEqual(cases.limits));
  it("what a clip's files are called", () => {
    for (const c of cases.files) {
      const page = { url: "", title: "", images: Array.from({ length: c.pictures }, () => ({ src: "" })), pdfs: Array.from({ length: c.pdfs }, () => ({ name: "a.pdf" })) };
      expect(filesWord(page)).toBe(c.word);
    }
  });
  for (const c of cases.choices as unknown as { name: string; suggestions: Suggestions; files: string | null; choices: unknown }[])
    it(`the choices: ${c.name}`, () => expect(choices(c.suggestions, c.files)).toEqual(c.choices as ReturnType<typeof choices>));
  for (const c of cases.tags as { name: string; all: ClipTags["tags"]; picked: string[]; offered: ClipTags["tags"]; more: string[] }[])
    it(`the tags not picked: ${c.name}`, () => expect(unpickedTags(c.all, c.picked)).toEqual({ offered: c.offered, more: c.more }));
  it("the contract a companion draws: bumped here and there together", () => expect(COMPANION_CONTRACT).toBe(cases.contract));
  it("the task lists, in the order and under the names a companion offers", () =>
    expect(OPENING_LISTS.map((l) => [l, TASK_LIST_LABEL[l]])).toEqual(cases.taskLists));
  it("the JPEG qualities, as whole percents", () =>
    expect({ stored: Math.round(QUALITY * 100), look: Math.round(LOOK_QUALITY * 100) }).toEqual(cases.jpeg));
  it("the server's address as typed: the origin the URL standard gives for an https address, else none", () => {
    // The companion's own rule (no core copy to run): checked against the platform's, so a case can't be one nobody reads that way.
    const origin = (input: string) => {
      const typed = input.trim();
      try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
        return url.protocol === "https:" ? url.origin : null;
      } catch {
        return null;
      }
    };
    for (const c of cases.addresses) expect(origin(c.input)).toBe(c.origin);
  });
  describe("a tick shown before the server has it", () => {
    // What a widget draws from the tick to the next feed is the feed the server would send without that task: the cases'
    // `feed` and `after` are made here, from `tasks`, so the Kotlin that cuts one from the other is held to the server's own.
    const bare = (tasks: Task[]) => { const { look: _, ...rest } = tasksFeed(tasks, "today", TODAY, [], null, DEFAULT_LOOK); return rest; };
    for (const c of cases.withoutTask) it(c.name, () => {
      const all = c.tasks.map((t) => task(t.id, { when: TODAY, evening: t.evening, order: t.order }));
      expect(bare(all)).toEqual(c.feed as ReturnType<typeof bare>);
      expect(bare(all.filter((t) => t.id !== c.tick))).toEqual(c.after as ReturnType<typeof bare>);
    });
  });
  it("what a save says", () => {
    for (const c of cases.results as unknown as { result: ClipResult; line: string; notice: string | null }[]) {
      expect(describeResult(c.result)).toBe(c.line);
      expect(summaryNotice(c.result)).toBe(c.notice);
    }
  });
});
