// The display tools (src/widgetTools.ts) and the rules they compute by (src/plan.ts): a day, a week, a review, free time, a quote, a
// link and a lens preview. What each returns is a `widget` the core's `widgetOf` reads back; the model is told titles and ids only.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { addDays } from "@/core/dates";
import { localDay } from "@/core/time";
import { newTask, type Task } from "@/core/todo";
import { widgetOf } from "@/core/widgets";
import { fromWeb } from "../src/guard";
import type { Meta } from "../src/notes";
import { Notes } from "../src/notes";
import { dayOfTasks, freeSlots, quoteIn, reviewOf, STALLED_DAYS, weekOfTasks, type Stamp } from "../src/plan";
import { Todo } from "../src/todo";
import { tools } from "../src/tools";
import { fakePb } from "./fake-pb";

let n = 0;
const task = (title: string, o: Partial<Task> = {}): Task => newTask(`t${++n}`.padEnd(15, "0"), { title, order: n, ...o });
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe("a day", () => {
  const D = "2026-11-06";
  it("lists what is booked by the hour, flags two in one hour, then the rest planned for it or due on it", () => {
    const w = dayOfTasks([
      task("Lunch", { when: D, remind: "13:00" }), task("Dentist", { when: D, remind: "10:00" }), task("Call", { when: D, remind: "10:30" }),
      task("Late", { when: D, remind: "23:15" }), task("Laundry", { when: D }), task("Report", { due: D }), task("Tomorrow", { when: "2026-11-07" }),
      task("Ticked", { when: D, remind: "11:00", done: D }), task("Earlier", { when: D, done: "2026-11-05" }),
      task("Booked elsewhere, due here", { when: "2026-11-07", remind: "09:00", due: D }),
    ], D);
    expect(w.booked.map((b) => [b.task.title, b.at, b.until, b.clash ?? false])).toEqual([
      ["Dentist", "10:00", "11:00", true], ["Call", "10:30", "11:00", true], ["Lunch", "13:00", "14:00", false], ["Late", "23:15", "24:00", false]]);
    expect(titles(w.unscheduled)).toEqual(["Laundry", "Report", "Booked elsewhere, due here"]);
    expect(w.done).toBe(1);
    expect(w.more).toBeUndefined();
  });
  it("caps the others at 20 and says how many more", () => {
    const w = dayOfTasks(Array.from({ length: 23 }, (_, i) => task(`t${i}`, { when: D })), D);
    expect([w.unscheduled.length, w.more]).toEqual([20, 3]);
  });
});

describe("a week", () => {
  it("counts each day's open tasks, those at an hour, the overdue ones (a day gone by) and the first titles, booked first", () => {
    const w = weekOfTasks([
      task("a", { when: "2026-11-02" }), task("b", { when: "2026-11-04", remind: "15:00" }), task("c", { when: "2026-11-04" }), task("d", { due: "2026-11-04" }),
      task("e", { when: "2026-11-04", remind: "09:00" }), task("f", { when: "2026-11-04" }), task("done", { when: "2026-11-04", done: "2026-11-04" }),
      task("next week", { when: "2026-11-09" }),
    ], "2026-11-02", "2026-11-04");
    expect(w.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(w.days[0]).toMatchObject({ open: 1, booked: 0, overdue: 1 });
    expect(w.days[1]).toEqual({ date: "2026-11-03", open: 0, booked: 0, overdue: 0, top: [] });
    expect(w.days[2]).toMatchObject({ open: 5, booked: 2, overdue: 0 });
    expect(titles(w.days[2].top)).toEqual(["e", "b", "c"]);
  });
});

describe("free time", () => {
  const D = "2026-11-06", at = (h: string) => task("x", { when: D, remind: h });
  it("the working hours minus the hours that are held, gaps at least as long as asked", () => {
    const t = [at("10:00"), at("11:30"), task("no hour", { when: D }), task("other day", { when: "2026-11-07", remind: "14:00" }), task("done", { when: D, remind: "15:00", done: D })];
    expect(freeSlots(t, D, 60)).toEqual({ booked: 2, slots: [{ from: "09:00", to: "10:00", minutes: 60 }, { from: "12:00", to: "18:00", minutes: 360 }] });
    expect(freeSlots(t, D, 90).slots).toEqual([{ from: "12:00", to: "18:00", minutes: 360 }]);
    expect(freeSlots(t, D, 400).slots).toEqual([]);
  });
  it("within a window of its own; a booking outside it, or one that spans its edge, is dealt with", () => {
    expect(freeSlots([at("08:30"), at("14:00")], D, 30, "08:00", "15:00").slots).toEqual([
      { from: "09:00", to: "14:00", minutes: 300 }]);
    expect(freeSlots([at("13:00")], D, 30, "13:30", "16:00").slots).toEqual([{ from: "14:00", to: "16:00", minutes: 120 }]);
  });
  it("today: nothing before the next quarter hour", () => {
    expect(freeSlots([at("16:00")], D, 30, "09:00", "18:00", new Date(2026, 10, 6, 15, 10)).slots).toEqual([
      { from: "15:15", to: "16:00", minutes: 45 }, { from: "17:00", to: "18:00", minutes: 60 }]);
    expect(freeSlots([], D, 30, "09:00", "18:00", new Date(2026, 10, 5, 15, 10)).slots).toEqual([{ from: "09:00", to: "18:00", minutes: 540 }]);   // another day: untouched
  });
});

describe("a review", () => {
  const NOW = new Date(2026, 10, 6, 12), at = (day: number, month = 10) => new Date(2026, month, day, 10).getTime();
  const stamp = (created: number, updated = created): Stamp => ({ created, updated });
  const meta = (slug: string, created: string, updated: number, tags: string[]): Meta => ({
    rec: slug, path: `notes/${slug}.md`, kind: "note", rev: 1, text: `---\ntitle: ${slug}\ncreated: ${created}\n---\nbody\n`, title: slug, tags, pinned: false, updated, tainted: false,
  });
  it("counts what was done, added and touched in the window; stalled is open and unchanged for 14 days; the busiest tags", () => {
    const made = task("Made and done", { done: "2026-11-04", tags: ["work"] }), ticked = task("Old, ticked now", { done: "2026-11-05", tags: ["Work", "home"] });
    const stale = task("Stale", { tags: ["home"] }), staler = task("Staler"), fresh = task("Fresh"), before = task("Before the window", { done: "2026-10-20" });
    const stamps = new Map<string, Stamp>([
      [made.id, stamp(at(3), at(4))], [ticked.id, stamp(at(1, 9), at(5))], [stale.id, stamp(at(1, 9), at(22, 9))], [staler.id, stamp(at(1, 8), at(1, 9))],
      [fresh.id, stamp(at(5), at(5))], [before.id, stamp(at(1, 9), at(20, 9))],
    ]);
    const notes = [
      meta("new", "2026-11-02", at(2), ["work"]), meta("edited", "2026-10-01", at(5), ["home", "work"]), meta("quiet", "2026-10-01", at(10, 9), ["home"]),
    ];
    const r = reviewOf([made, ticked, stale, staler, fresh, before], stamps, notes, 7, NOW);
    expect([r.from, r.to, r.days]).toEqual(["2026-10-31", "2026-11-06", 7]);
    expect([r.done, r.added, r.notesAdded, r.notesEdited]).toEqual([2, 2, 1, 1]);
    expect(r.stalled.map((s) => [s.task.title, s.idle])).toEqual([["Staler", 36], ["Stale", 15]]);       // not Fresh; longest idle first
    expect(r.stalledTotal).toBe(2);
    // work: made+done, ticked (Work), the new note, the edited one; home: ticked, the edited one; (fresh has none)
    expect(r.tags).toEqual([{ tag: "work", count: 4 }, { tag: "home", count: 2 }]);
    expect(STALLED_DAYS).toBe(14);
  });
  it("a day count of 1 is today alone", () => {
    const t = task("Today", { done: "2026-11-06" });
    const r = reviewOf([t], new Map([[t.id, stamp(at(6))]]), [], 1, NOW);
    expect([r.from, r.to, r.done, r.added]).toEqual(["2026-11-06", "2026-11-06", 1, 1]);
  });
});

describe("a quote", () => {
  const body = "The garage door code is 1234.\n\nIt sticks in\n   winter, so lift while you press.";
  it("is found whitespace aside, with what surrounds it", () => {
    expect(quoteIn(body, "sticks   in winter,")).toEqual({ quote: "sticks in winter,", before: "The garage door code is 1234. It ", after: " so lift while you press." });
    expect(quoteIn("x".repeat(200) + " needle " + "y".repeat(200), "needle")).toEqual({
      quote: "needle", before: expect.stringMatching(/^…x{79} $/), after: expect.stringMatching(/^ y{79}…$/) });
  });
  it("is not found when a word differs, or the case", () => {
    expect(quoteIn(body, "the garage door")).toBeNull();
    expect(quoteIn(body, "lift while you push")).toBeNull();
    expect(quoteIn(body, "   ")).toBeNull();
  });
});

describe("the tools", () => {
  const pb = fakePb();
  afterAll(() => pb.stop());
  let notes: Notes, todo: Todo, T: ReturnType<typeof tools>;
  beforeEach(() => {
    pb.notes.clear(); pb.chats.clear(); pb.tasks.clear(); pb.links.clear(); pb.meanwhile();
    pb.tags.splice(0, pb.tags.length, { id: "t1", name: "Σπίτι", description: "" }, { id: "t2", name: "work", description: "" }, { id: "t3", name: "archive", description: "" });
    notes = new Notes({ url: pb.url });
    todo = new Todo({ url: pb.url });
    T = tools(notes, todo);
  });
  const run = <I,>(t: { execute?: (i: I, o: never) => unknown }, i: I, messages: ModelMessage[] = []) => t.execute!(i, { toolCallId: "c", messages } as never);
  const file = (title: string, body = "- x\n", extra = "") => `---\ntitle: ${title}\ncreated: 2026-10-01\n${extra}---\n${body}`;
  const put = (t: Task, extra: object = {}) => { pb.tasks.set(t.id, { ...t, rev: 1, created: "2026-11-01 10:00:00.000Z", updated: "2026-11-01 10:00:00.000Z", ...extra }); return t; };
  /** What the model is told of a result. */
  const told = async (name: keyof ReturnType<typeof tools>, input: object, output: unknown) =>
    ((T[name] as { toModelOutput: (o: unknown) => Promise<{ value: unknown }> | { value: unknown } }).toModelOutput({ toolCallId: "c", input, output })) as { type: string; value: unknown };
  const TODAY = localDay();

  it("show_day: defaults to today; the widget reads back; the model gets titles, ids and times, no cards", async () => {
    const a = put(task("Dentist", { when: TODAY, remind: "10:00" })), b = put(task("Call", { when: TODAY, remind: "10:20" })), c = put(task("Laundry", { when: TODAY }));
    const r = await run(T.show_day, {} as never);
    const w = widgetOf(r);
    expect(w).toMatchObject({ type: "day", date: TODAY, booked: [{ at: "10:00", clash: true }, { at: "10:20", clash: true }], unscheduled: [{ title: "Laundry" }] });
    expect(await told("show_day", {}, r)).toEqual({ type: "json", value: {
      shown: "day", date: TODAY, done: 0, booked: [{ at: "10:00", id: a.id, title: "Dentist", clash: true }, { at: "10:20", id: b.id, title: "Call", clash: true }],
      unscheduled: [{ id: c.id, title: "Laundry" }] } });
    expect(await run(T.show_day, { date: "2026-02-30" } as never)).toEqual({ error: "2026-02-30 is not a YYYY-MM-DD day." });
  });

  it("show_week: from the Monday of this week unless given a start", async () => {
    const r = await run(T.show_week, {} as never), w = widgetOf(r);
    expect(w?.type === "week" && w.days).toHaveLength(7);
    const day = new Date(`${w?.type === "week" ? w.start : ""}T12:00:00`).getDay();
    expect(day).toBe(1);
    const s = widgetOf(await run(T.show_week, { start: addDays(TODAY, 3) } as never));
    expect(s?.type === "week" && s.start).toBe(addDays(TODAY, 3));
  });

  it("show_review: reads the server's own created and updated stamps", async () => {
    const old = put(task("Neglected"), { created: "2026-01-01 10:00:00.000Z", updated: "2026-01-01 10:00:00.000Z" });
    put(task("Fresh", { tags: ["work"] }), { created: `${TODAY} 08:00:00.000Z`, updated: `${TODAY} 08:00:00.000Z` });
    const w = widgetOf(await run(T.show_review, {} as never));
    expect(w).toMatchObject({ type: "review", days: 7, to: TODAY, stalledTotal: 1, stalled: [{ task: { id: old.id } }] });
    const r = await run(T.show_review, { days: 30 } as never);
    expect(JSON.stringify(await told("show_review", {}, r))).toContain(old.id);
  });

  it("show_quote: the note's own words, with its title; an error for words it doesn't hold, and a note that isn't there", async () => {
    pb.put("notes/a.md", file("Garage", "The door code is 1234.\n\nIt sticks in\nwinter.\n"));
    const r = await run(T.show_quote, { path: "notes/a.md", quote: "sticks in winter." });
    expect(widgetOf(r)).toEqual({ type: "quote", path: "notes/a.md", title: "Garage", quote: "sticks in winter.", before: "The door code is 1234. It ", after: "" });
    expect(await told("show_quote", {}, r)).toEqual({ type: "json", value: { shown: "quote", path: "notes/a.md", title: "Garage" } });
    expect(await run(T.show_quote, { path: "notes/a.md", quote: "sticks in summer" })).toEqual({ error: expect.stringMatching(/^That isn't in notes\/a\.md word for word/) });
    expect(await run(T.show_quote, { path: "notes/nope.md", quote: "x" })).toEqual({ error: expect.stringMatching(/^No note/) });
    expect(widgetOf(await run(T.show_quote, { path: "notes/nope.md", quote: "x" }))).toBeNull();
  });

  it("show_link: the server's own preview route (which holds the address guard); the model learns the URL only", async () => {
    const r = await run(T.show_link, { url: "https://example.com/post" });
    expect(widgetOf(r)).toEqual({ type: "link", preview: expect.objectContaining({ url: "https://example.com/post", title: "Example page" }) });
    expect(await told("show_link", {}, r)).toEqual({ type: "json", value: { shown: "link", url: "https://example.com/post" } });
    expect(await run(T.show_link, { url: "http://10.0.0.5/admin" })).toEqual({ error: expect.stringMatching(/^The server won't fetch that address/) });
    expect(await run(T.show_link, { url: "https://example.com/empty" })).toEqual({ error: expect.stringMatching(/no title or picture/) });
  });

  it("show_link: not once the chat has read the web: a card is a fetch of a URL the page may have chosen", async () => {
    const web: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "w", toolName: "web_search", output: { type: "json", value: {} } }] };
    expect(await run(T.show_link, { url: "https://example.com/post" }, [web])).toEqual({ error: expect.stringMatching(/^This chat has read the web/) });
  });

  it("show_lens: counts the notes and open tasks it would show, a sample of each; nothing is written", async () => {
    for (let i = 0; i < 7; i++) pb.put(`notes/w${i}.md`, file(`Work ${i}`, "x\n", "tags: [work]\n"), { updated: `2026-10-0${i + 1} 12:00:00.000Z` });
    pb.put("notes/old.md", file("Old work", "x\n", "tags: [work, archive]\n"));
    pb.put("notes/home.md", file("Home", "x\n", "tags: [Σπίτι]\n"));
    for (let i = 0; i < 6; i++) put(task(`Job ${i}`, { tags: ["work"] }));
    put(task("Done job", { tags: ["work"], done: "2026-11-01" })); put(task("Chore", { tags: ["Σπίτι"] }));
    const r = await run(T.show_lens, { tags: ["WORK"], exclude: ["archive"], name: "Work", accent: "teal" });
    const w = widgetOf(r);
    expect(w).toMatchObject({ type: "lens", tags: ["work"], exclude: ["archive"], name: "Work", accent: "teal", notes: { count: 7 }, tasks: { count: 6 } });
    expect(w?.type === "lens" && [w.notes.sample.length, w.tasks.sample.length]).toEqual([5, 5]);
    expect(w?.type === "lens" && w.notes.sample[0].path).toBe("notes/w6.md");                 // newest edit first
    const told = await T.show_lens.toModelOutput!({ toolCallId: "c", input: {} as never, output: r as never });
    expect(JSON.stringify(told)).toContain("notes/w6.md");
    expect(pb.created).toEqual([]);
    expect(await run(T.show_lens, { tags: ["nope"] })).toEqual({ error: expect.stringMatching(/^Not an existing tag: nope/) });
    expect(await run(T.show_lens, { tags: [], exclude: [] })).toEqual({ error: expect.stringMatching(/at least one tag/) });
    expect(await run(T.show_lens, { tags: ["work"], exclude: ["Work"] })).toEqual({ error: expect.stringMatching(/both shown and hidden/) });
  });

  it("show_lens: only hiding tags shows everything else", async () => {
    pb.put("notes/a.md", file("A", "x\n", "tags: [archive]\n")); pb.put("notes/b.md", file("B"));
    expect(widgetOf(await run(T.show_lens, { tags: [], exclude: ["archive"] }))).toMatchObject({ notes: { count: 1 }, exclude: ["archive"] });
  });

  it("find_free_slots: plain data for the model, no widget", async () => {
    put(task("Dentist", { when: "2999-01-01", remind: "10:00" }));
    const r = await run(T.find_free_slots, { date: "2999-01-01", minutes: 60 } as never);
    expect(r).toEqual({ date: "2999-01-01", minutes: 60, from: "09:00", to: "18:00", booked: 1, slots: [{ from: "09:00", to: "10:00", minutes: 60 }, { from: "11:00", to: "18:00", minutes: 420 }] });
    expect(widgetOf(r)).toBeNull();
    expect(await run(T.find_free_slots, { date: "2999-01-01", minutes: 30, from: "15:00", to: "10:00" } as never)).toEqual({ error: "`from` has to be before `to`." });
  });

  it("the widgets write nothing, ask nothing, and what they show of a tainted record counts as the web read", async () => {
    pb.put("notes/w.md", file("From the web", "alpha beta\n")); pb.notes.get("notes/w.md")!.tainted = true;
    const r = await run(T.show_quote, { path: "notes/w.md", quote: "alpha beta" });
    const model = await told("show_quote", {}, r);
    const result: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "show_quote", output: model as never }] };
    expect(fromWeb([result], new Set(["notes/w.md"]))).toBe(true);
    expect(pb.created).toEqual([]);
    for (const name of ["show_day", "show_week", "show_review", "show_quote", "show_link", "show_lens", "find_free_slots"] as const)
      expect("needsApproval" in T[name] && T[name].needsApproval).toBeFalsy();
  });
});
