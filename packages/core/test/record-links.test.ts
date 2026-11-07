// Links between records (src/record-links.ts): the wire columns both ways, what a link may not be, and the questions a
// client asks of a list of them (a task's notes, a note's backlinks). The calls (src/pocketbase.ts `links`) against a
// stubbed fetch: idempotent make and delete.
import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  backlinks, LINK_COLUMNS, linksForNextRound, linkOf, linkProblem, linkRecord, linksFrom, linksOf, linksTo, newLink, notesOfTask, sameLink, tasksAbout, type Link,
} from "../src/record-links";
import { linkFilter, links } from "../src/pocketbase";
import { noteKindOf } from "../src/notes";

const T = { type: "task", id: "t1" } as const, N = { type: "note", id: "n1" } as const, N2 = { type: "note", id: "n2" } as const;
const N3 = { type: "note", id: "n3" } as const, T3 = { type: "task", id: "t3" } as const;

describe("the wire", () => {
  it("every end column, in the server's index order", () => {
    expect(LINK_COLUMNS).toEqual(["fromNote", "fromTask", "toNote", "toTask"]);
  });
  it("a link out of a record and back: one end a side, the rest empty", () => {
    const l = newLink("l1", T, N, "about");
    const r = linkRecord(l);
    expect(r).toEqual({ id: "l1", fromNote: "", fromTask: "t1", toNote: "n1", toTask: "", role: "about" });
    expect(linkOf({ ...r, created: "2026-11-02 10:00:00.000Z" })).toEqual(l);
  });
  it("a record that isn't a link is null: no end, two ends on a side, an unknown role, one to itself", () => {
    const r = linkRecord(newLink("l1", T, N, "about"));
    expect(linkOf({ ...r, fromTask: "" })).toBeNull();
    expect(linkOf({ ...r, fromNote: "n9" })).toBeNull();
    expect(linkOf({ ...r, role: "likes" })).toBeNull();
    expect(linkOf({ ...r, fromTask: "", fromNote: "n1" })).toBeNull();
  });
  it("newLink refuses what the server would", () => {
    expect(() => newLink("l1", N, N, "about")).toThrow(/itself/);
    expect(linkProblem({ from: N, to: N2, role: "x" as never })).toMatch(/role/);
    expect(linkProblem({ from: N, to: { type: "task", id: "n1" }, role: "about" })).toBeNull();     // same id, another kind of record
  });
});

describe("questions of a list of links", () => {
  const all: Link[] = [
    newLink("a", T, N, "about"), newLink("b", T, N2, "about"), newLink("c", N2, N3, "source"),
    newLink("d", { type: "task", id: "t2" }, N, "about"), newLink("e", N, T3, "source"),
  ];
  it("a task's notes, in order; the tasks about a note", () => {
    expect(notesOfTask(all, "t1")).toEqual(["n1", "n2"]);
    expect(tasksAbout(all, "n1")).toEqual(["t1", "t2"]);
  });
  it("a note's backlinks: whatever points at it, of any role", () => {
    expect(backlinks(all, "n1").map((l) => l.id)).toEqual(["a", "d"]);
    expect(backlinks(all, "n3").map((l) => l.id)).toEqual(["c"]);
  });
  it("from, to and either side, by role", () => {
    expect(linksFrom(all, N).map((l) => l.id)).toEqual(["e"]);
    expect(linksTo(all, N2, "source")).toEqual([]);
    expect(linksOf(all, N2).map((l) => l.id)).toEqual(["b", "c"]);
  });
  it("a repeating task's next round is linked as it was, under new ids", () => {
    let n = 0;
    expect(linksForNextRound(all, "t1", "t9", () => `new${++n}`)).toEqual([newLink("new1", { type: "task", id: "t9" }, N, "about"), newLink("new2", { type: "task", id: "t9" }, N2, "about")]);
  });
  it("the same relation whatever the ids", () => {
    expect(sameLink(newLink("x", T, N, "about"), all[0])).toBe(true);
    expect(sameLink(newLink("x", T, N, "source"), all[0])).toBe(false);
  });
});

describe("a note's kind", () => {
  it("is the column's, a kind this client doesn't know shown as a note", () => {
    expect(noteKindOf("capture")).toBe("note");      // the screenshot captures' old kind
    expect(noteKindOf("note")).toBe("note");
    expect(noteKindOf("recipe")).toBe("note");
    expect(noteKindOf(undefined)).toBe("note");
  });
});

const S = { url: "https://n:8097" };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const stub = (f: (url: string, init?: RequestInit) => Response) => {
  const m = mock(async (url: string, init?: RequestInit) => f(url, init));
  globalThis.fetch = m as unknown as typeof fetch;
  return m;
};

describe("the links calls", () => {
  const l = newLink("l1", T, N, "about"), wire = linkRecord(l);
  it("lists one end's links by its column, either side for `of`", async () => {
    const f = stub(() => Response.json({ items: [wire, { id: "bad", role: "about" }] }));
    expect(await links.to(S, N)).toEqual([l]);
    expect(decodeURIComponent(f.mock.calls[0][0])).toContain(`filter=${linkFilter("to", N)}`);
    expect(linkFilter("from", T)).toBe('fromTask = "t1"');
    await links.of(S, N);
    expect(decodeURIComponent(f.mock.calls[1][0])).toContain('filter=fromNote = "n1" || toNote = "n1"');
  });
  it("makes one with every column sent", async () => {
    const f = stub(() => Response.json(wire));
    expect(await links.add(S, l)).toEqual(l);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/collections/links/records");
    expect(JSON.parse(init.body as string)).toEqual(wire);
  });
  it("a make the server has already (by id, or the same ends under another id) is the one meant", async () => {
    let n = 0;
    stub((_u, init) => (init?.method === "POST" ? Response.json({ data: { fromNote: { code: "validation_not_unique" } } }, { status: 400 })
      : Response.json({ items: [n++ === 0 ? { ...wire, id: "other" } : wire] })));
    expect(await links.add(S, l)).toEqual({ ...l, id: "other" });
  });
  it("a refused make with nothing like it on the server stays an error", async () => {
    stub((_u, init) => (init?.method === "POST" ? Response.json({ message: "A link joins two records" }, { status: 400 }) : Response.json({ items: [] })));
    await expect(links.add(S, l)).rejects.toThrow();
  });
  it("a delete of one gone is done", async () => {
    stub(() => new Response(null, { status: 404 }));
    await expect(links.remove(S, "l1")).resolves.toBeUndefined();
  });
});
