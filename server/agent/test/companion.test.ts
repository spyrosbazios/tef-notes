// The native companion's routes over a fake PocketBase: what a widget is told to draw, and its two writes. The rows'
// rules are the core's (packages/core/test/companion.test.ts); here, that they are read through the owner's lens and
// colours and that a tick and a new task land as the app's own would.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_LOOK, type Hello, type NotesFeed, type TasksFeed } from "@/core/companion";
import { serializeNote } from "@/core/notes";
import { DEFAULT_PREFS } from "@/core/prefs";
import { ACCENTS, THEMES } from "@/core/theme";
import { localDay } from "@/core/time";
import { newTask, type Task } from "@/core/todo";
import { addTaskRoute, helloRoute, lensRoute, notesRoute, tasksRoute, tickRoute } from "../src/companion";
import { fakePb } from "./fake-pb";

const TODAY = localDay();
let pb: ReturnType<typeof fakePb>;
beforeEach(() => { pb = fakePb(); });
afterEach(() => pb.stop());

const put = (t: Task) => { pb.tasks.set(t.id, { ...t, rev: 1, created: "2026-11-01 10:00:00.000Z", updated: "2026-11-01 10:00:00.000Z" }); return t; };
const task = (id: string, fields: Partial<Task> = {}) => put({ ...newTask(id, { title: `Task ${id}`, order: 0 }), ...fields });
const post = (body: unknown) => new Request("http://x/agent/companion/tasks", { method: "POST", body: JSON.stringify(body) });
const list = async (name: string) => (await (await tasksRoute(new Request(`http://x/agent/companion/tasks?list=${name}`), pb)).json()) as TasksFeed;
const lensOn = () => {
  pb.lenses.push({ id: "w", name: "Work", tags: ["work"], exclude: [], accent: "teal", theme: "" });
  pb.prefs.push({ id: "p", key: "owner", data: { ...DEFAULT_PREFS, theme: "nord", lens: "w", clip: { summary: true } } });
};

describe("hello", () => {
  it("answers with the defaults before any preference is saved", async () => {
    expect(await (await helloRoute(pb)).json() as Hello).toEqual({ app: "tefnotes", contract: 2, look: DEFAULT_LOOK, summary: false, tag: null });
  });
  it("answers in the owner's theme, the lens's accent, the summary box as left", async () => {
    lensOn();
    expect(await (await helloRoute(pb)).json() as Hello).toMatchObject({ look: { bg: THEMES.nord.C.bg, brand: ACCENTS.teal.dark }, summary: true, tag: "work" });
  });
});

describe("the task lists", () => {
  it("a list by name, Today when none is asked for", async () => {
    task("a", { when: TODAY }); task("b");
    expect((await list("today")).sections.map((s) => s.tasks.map((t) => t.id))).toEqual([["a"]]);
    expect((await list("inbox")).sections.map((s) => s.tasks.map((t) => t.id))).toEqual([["b"]]);
    expect((await (await tasksRoute(new Request("http://x/agent/companion/tasks"), pb)).json() as TasksFeed).list).toBe("today");
  });
  it("is seen through the lens on", async () => {
    lensOn();
    task("a", { tags: ["work"] }); task("b");
    const f = await list("inbox");
    expect(f.title).toBe("Inbox · Work");
    expect(f.sections[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(f.look.brand).toBe(ACCENTS.teal.dark);
  });
});

describe("a new task", () => {
  it("added from Today is planned for today, after the last one", async () => {
    task("a", { order: 4 });
    const r = await addTaskRoute(post({ title: " Buy milk ", list: "today" }), pb);
    const { id } = await r.json() as { id: string };
    expect(pb.tasks.get(id)).toMatchObject({ title: "Buy milk", when: TODAY, order: 5, rev: 1, done: "" });
  });
  it("added from the Inbox has no day, and carries the lens's tag", async () => {
    lensOn();
    const { id } = await (await addTaskRoute(post({ title: "Call" }), pb)).json() as { id: string };
    expect(pb.tasks.get(id)).toMatchObject({ title: "Call", when: "", tags: ["work"] });
  });
  it("is refused without a title", async () => {
    expect((await addTaskRoute(post({ title: " " }), pb)).status).toBe(400);
    expect((await addTaskRoute(new Request("http://x", { method: "POST", body: "not json" }), pb)).status).toBe(400);
    expect(pb.tasks.size).toBe(0);
  });
});

describe("a tick", () => {
  it("ticks the task over the rev it is at", async () => {
    task("a");
    expect(await (await tickRoute(pb, "a")).json()).toEqual({ ok: true });
    expect(pb.tasks.get("a")).toMatchObject({ done: TODAY, rev: 2 });
  });
  it("rolls a repeating task over", async () => {
    task("a", { when: TODAY, every: "1d" });
    await tickRoute(pb, "a");
    const next = [...pb.tasks.values()].find((t) => t.id !== "a");
    expect(pb.tasks.get("a")).toMatchObject({ done: TODAY, every: "" });
    expect(next).toMatchObject({ title: "Task a", done: "", every: "1d" });
    expect(next!.when > TODAY).toBe(true);
  });
  it("leaves one already ticked as it is, and says when it is gone", async () => {
    task("a", { done: "2026-11-01" });
    expect((await tickRoute(pb, "a")).status).toBe(200);
    expect(pb.tasks.get("a")).toMatchObject({ done: "2026-11-01", rev: 1 });
    expect((await tickRoute(pb, "nope")).status).toBe(404);
  });
});

describe("the notes", () => {
  it("pinned first, each row opening its note", async () => {
    const note = (id: string, pinned = false) => pb.put(`notes/${id}.md`, serializeNote({ title: `Note ${id}`, created: "2026-11-01", ...(pinned ? { pinned: true } : {}) }, "Some words.\n"));
    note("a"); note("b", true);
    const f = await (await notesRoute(pb)).json() as NotesFeed;
    expect(f.notes[0]).toEqual({ id: "b", title: "Note b", peek: "Some words.", pinned: true, url: "/note/b" });
    expect(f.notes.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("the lens", () => {
  const pick = (lens: unknown) => lensRoute(new Request("http://x/agent/companion/lens", { method: "POST", body: JSON.stringify({ lens }) }), pb);
  it("a feed offers the lenses, the one on marked", async () => {
    lensOn();
    expect((await list("today")).lenses).toEqual([{ id: "", name: "No lens", on: false }, { id: "w", name: "Work", on: true }]);
    expect((await (await notesRoute(pb)).json() as NotesFeed).ask).toBe("/?ask=1");
  });
  it("is turned off and on in the owner's preferences, the others kept", async () => {
    lensOn();
    expect((await pick("")).status).toBe(200);
    expect(pb.prefs[0].data).toMatchObject({ lens: null, theme: "nord", clip: { summary: true } });
    expect((await list("inbox")).title).toBe("Inbox");
    await pick("w");
    expect(pb.prefs[0].data.lens).toBe("w");
  });
  it("makes the record when no preference was saved yet", async () => {
    pb.lenses.push({ id: "w", name: "Work", tags: ["work"], exclude: [], accent: "", theme: "" });
    await pick("w");
    expect(pb.prefs).toHaveLength(1);
    expect(pb.prefs[0]).toMatchObject({ key: "owner", data: { lens: "w" } });
  });
  it("refuses a lens that is gone, and a body that names none", async () => {
    expect((await pick("nope")).status).toBe(404);
    expect((await pick(3)).status).toBe(400);
    expect(pb.prefs).toHaveLength(0);
  });
});
