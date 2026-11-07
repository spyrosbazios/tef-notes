// Lenses on the phone (store/lenses.ts, core/lens.ts): the definitions kept from the server, the one this phone has on (a pref, so a
// stale id reads as none), what the stores make while one is on (a new note and a new task carry its first tag, a note the sync
// brings down does not), the tasks it lets through, and the assistant's context saying so.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lensViews } from "@/store/todo";
import * as pb from "@/core/pocketbase";
import { LENS_FILTER, withinLens, type Lens } from "@/core/lens";
import { parseNote, serializeNote } from "@/core/notes";
import { newTask, type Task } from "@/core/todo";
import { contextFor, type Look } from "@/store/assistant";
import { useKeys } from "@/store/keys";
import { activeLensNow, deleteLens, refreshLenses, saveLens, setActiveLens, useLenses } from "@/store/lenses";
import { syncNotes, useNotes } from "@/store/notes";
import { usePrefs } from "@/store/prefs";
import { reloadTodo, useTodo } from "@/store/todo";
import { fake } from "./helpers";

vi.mock("@/store/db", async () => (await import("./helpers")).fake);
vi.mock("@/store/storage", async () => (await import("./helpers")).fakeStorage);
vi.mock("expo-secure-store", () => ({ getItem: () => null, setItem: () => {}, deleteItemAsync: async () => {} }));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("@/store/live", () => ({ useLive: () => {} }));
vi.mock("@/store/attachments", () => ({ syncAttachments: async () => {}, moveAttachments: vi.fn() }));
vi.mock("@/core/pocketbase", async (orig) => ({
  ...(await orig<typeof import("@/core/pocketbase")>()),
  list: vi.fn(), get: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), photos: vi.fn(),
  lenses: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const WORK: Lens = { rec: "l1", name: "Work", tags: ["work", "clients"], exclude: [], accent: null };
const HOME: Lens = { rec: "l2", name: "Home", tags: ["home"], exclude: [], accent: null };
const lenses = vi.mocked(pb.lenses);

const task = (id: string, tags: string[], fields: Partial<Task> = {}): Task => ({ ...newTask(id, { title: id, tags }), ...fields });

beforeEach(() => {
  fake.reset();
  useKeys.setState({ keys: {} });
  useLenses.setState({ lenses: [WORK, HOME] });
  usePrefs.setState({ lensRec: null });
  Object.values(lenses).forEach((f) => f.mockReset());
  reloadTodo();
});

describe("the lens that is on", () => {
  it("is none until one is chosen, then the definition with its id", () => {
    expect(activeLensNow()).toBeNull();
    setActiveLens("l1");
    expect(usePrefs.getState().lensRec).toBe("l1");
    expect(activeLensNow()).toEqual(WORK);
    setActiveLens(null);
    expect(activeLensNow()).toBeNull();
  });

  it("reads as none once its definition is gone, and comes back if the definition does", () => {
    setActiveLens("l1");
    useLenses.setState({ lenses: [HOME] });
    expect(activeLensNow()).toBeNull();
    useLenses.setState({ lenses: [WORK, HOME] });
    expect(activeLensNow()).toEqual(WORK);
  });
});

describe("the definitions", () => {
  beforeEach(() => useKeys.setState({ keys: { server: "https://n" } }));

  it("are the server's, kept as they came; the cached ones stay when it can't be reached", async () => {
    lenses.list.mockResolvedValueOnce([HOME]);
    await refreshLenses();
    expect(useLenses.getState().lenses).toEqual([HOME]);
    lenses.list.mockRejectedValueOnce(new Error("offline"));
    await refreshLenses();
    expect(useLenses.getState().lenses).toEqual([HOME]);
  });

  it("make, change and remove a lens on the server, then re-read", async () => {
    lenses.list.mockResolvedValue([WORK]);
    await saveLens(null, { name: "Work", tags: ["work"], exclude: [], accent: null });
    expect(lenses.create).toHaveBeenCalledWith({ url: "https://n" }, { name: "Work", tags: ["work"], exclude: [], accent: null });
    await saveLens("l1", { name: "Work", tags: ["work", "clients"], exclude: [], accent: null });
    expect(lenses.update).toHaveBeenCalledWith({ url: "https://n" }, "l1", { name: "Work", tags: ["work", "clients"], exclude: [], accent: null });
    expect(useLenses.getState().lenses).toEqual([WORK]);
  });

  it("switch off the lens that is deleted, and only that one", async () => {
    lenses.list.mockResolvedValue([HOME]);
    setActiveLens("l2");
    await deleteLens("l1");
    expect(usePrefs.getState().lensRec).toBe("l2");
    await deleteLens("l2");
    expect(lenses.remove).toHaveBeenLastCalledWith({ url: "https://n" }, "l2");
    expect(usePrefs.getState().lensRec).toBeNull();
  });

  it("are not saved without a server", async () => {
    useKeys.setState({ keys: {} });
    await expect(saveLens(null, { name: "Work", tags: ["work"], exclude: [], accent: null })).rejects.toThrow("No server");
  });
});

describe("what is made under a lens", () => {
  it("a new note carries its first tag, beside the tags it was given", () => {
    setActiveLens("l1");
    const a = useNotes.getState().create("Plan");
    const b = useNotes.getState().create("Call", { tags: ["phone", "Work"] });
    expect(parseNote(a, fake.notes.get(a)!.text).tags).toEqual(["work"]);
    expect(parseNote(b, fake.notes.get(b)!.text).tags).toEqual(["phone", "Work"]);   // already there, ignoring case: once
  });

  it("a new note is untagged with no lens on", () => {
    const a = useNotes.getState().create("Plan");
    expect(fake.notes.get(a)!.text).not.toContain("tags:");
    expect(useNotes.getState().notes[a].tags).toEqual([]);
  });

  it("a new task carries its first tag; with none on, only its own", () => {
    setActiveLens("l2");
    const a = useTodo.getState().add({ title: "Paint", tags: ["diy"] }), b = useTodo.getState().add({ title: "Sweep" });
    expect(useTodo.getState().tasks[a].tags).toEqual(["diy", "home"]);
    expect(useTodo.getState().tasks[b].tags).toEqual(["home"]);
    setActiveLens(null);
    const c = useTodo.getState().add({ title: "Rest" });
    expect(useTodo.getState().tasks[c].tags).toEqual([]);
  });

  it("a note the sync brings down is not tagged", async () => {
    useKeys.setState({ keys: { server: "https://n" } });
    setActiveLens("l1");
    vi.mocked(pb.list).mockResolvedValue([{ rec: "r1", path: "notes/20261001-from-laptop.md", rev: 1, kind: "note" }]);
    vi.mocked(pb.get).mockResolvedValue({ rec: "r1", path: "notes/20261001-from-laptop.md", rev: 1, kind: "note", text: serializeNote({ title: "From the laptop", created: "2026-10-01" }, "hi") });
    await syncNotes();
    expect(useNotes.getState().notes["notes/20261001-from-laptop.md"].tags).toEqual([]);
  });
});

describe("what a lens lets through", () => {
  const today = "2026-11-05";
  const all: Record<string, Task> = Object.fromEntries([
    task("w-inbox", ["work"]), task("w-today", ["Clients"], { when: today }), task("w-done", ["work"], { done: "2026-11-04" }),
    task("h-inbox", ["home"]), task("h-today", ["home"], { when: today, evening: true }), task("plain", []),
  ].map((t) => [t.id, t]));
  const ids = (ts: Task[]) => ts.map((t) => t.id).sort();

  it("every list and count is over the lens's tasks, any of its tags", () => {
    const v = lensViews(WORK, all, today);
    expect(ids(v.inbox)).toEqual(["w-inbox"]);
    expect(ids(v.today)).toEqual(["w-today"]);
    expect(ids(v.logbook)).toEqual(["w-done"]);
    expect(v.evening).toEqual([]);
    expect(ids(lensViews(HOME, all, today).evening)).toEqual(["h-today"]);
  });

  it("is all of them with none on", () => {
    expect(lensViews(null, all, today).inbox).toHaveLength(3);
    expect(ids(lensViews(null, all, today).logbook)).toEqual(["w-done"]);
  });

  it("filters notes by their tags (the Notes and Home lists are this over the index)", () => {
    const notes = [{ tags: ["Work"] }, { tags: [] }, { tags: ["home", "clients"] }];
    expect(withinLens(WORK, notes)).toEqual([notes[0], notes[2]]);
    expect(withinLens(null, notes)).toBe(notes);
  });
});

describe("the assistant's context", () => {
  const look: Look = { pathOf: () => undefined, note: () => undefined, task: () => undefined, tags: [], list: null, lens: null };

  it("names the lens in `filter` while one is on, on every screen", () => {
    expect(contextFor("/home", { ...look, lens: WORK }).filter).toBe(`${LENS_FILTER}Work (tags: work, clients)`);
    expect(contextFor("/today", { ...look, lens: HOME }).filter).toBe(`${LENS_FILTER}Home (tags: home)`);
  });

  it("has no filter without one", () => {
    expect(contextFor("/home", look)).toEqual({ client: "phone", view: { kind: "home" } });
  });
});
