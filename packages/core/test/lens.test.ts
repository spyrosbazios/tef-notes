import { describe, expect, it } from "bun:test";
import { activeLens, contextFilter, inheritTags, inLens, lensColumns, lensAccent, lensFilter, lensOf, lensProblem, lensTag, withinLens, type Lens } from "../src/lens";
import { lenses } from "../src/pocketbase";

const work: Lens = { rec: "w", name: "Work", tags: ["work", "Clients"], exclude: [], accent: null };

describe("lensOf", () => {
  it("reads a record, cleaning its tags", () => {
    expect(lensOf({ id: "a", name: " Work ", tags: ["work", "#Work", " ", 3, "clients"] })).toEqual({ rec: "a", name: "Work", tags: ["work", "clients"], exclude: [], accent: null });
  });
  it("is empty where a column has the wrong shape", () => {
    expect(lensOf({ id: "a", name: 5, tags: "work" })).toEqual({ rec: "a", name: "", tags: [], exclude: [], accent: null });
    expect(lensOf(null)).toEqual({ rec: "", name: "", tags: [], exclude: [], accent: null });
  });
  it("writes trimmed columns", () => {
    expect(lensColumns({ name: " Work ", tags: ["a", "A", "b"], exclude: ["x", "X"], accent: null })).toEqual({ name: "Work", tags: ["a", "b"], exclude: ["x"], accent: "" });
  });
});

describe("lens accent", () => {
  it("reads a known accent, else none", () => {
    expect(lensOf({ id: "a", name: "W", accent: "teal" }).accent).toBe("teal");
    expect(lensOf({ id: "a", name: "W", accent: "theme" }).accent).toBeNull();
    expect(lensOf({ id: "a", name: "W", accent: "neon" }).accent).toBeNull();
  });
  it("overrides the device's pick only while set", () => {
    expect(lensAccent({ ...work, accent: "rose" }, "blue")).toBe("rose");
    expect(lensAccent(work, "blue")).toBe("blue");
    expect(lensAccent(null, "blue")).toBe("blue");
  });
});

describe("lensProblem", () => {
  it("wants a name and a tag", () => {
    expect(lensProblem({ name: " ", tags: ["a"], exclude: [] })).toBeTruthy();
    expect(lensProblem({ name: "Work", tags: [], exclude: [] })).toBeTruthy();
    expect(lensProblem({ name: "x".repeat(41), tags: ["a"], exclude: [] })).toBeTruthy();
    expect(lensProblem({ name: "Work", tags: ["a"], exclude: [] })).toBeNull();
    expect(lensProblem({ name: "Not done", tags: [], exclude: ["done"] })).toBeNull();
    expect(lensProblem({ name: "W", tags: ["a"], exclude: ["A"] })).toBeTruthy();
  });
});

describe("inLens", () => {
  it("takes an item with any of the tags, ignoring case and tonos", () => {
    expect(inLens(work, { tags: ["Work"] })).toBe(true);
    expect(inLens(work, { tags: ["home", "clients"] })).toBe(true);
    expect(inLens(work, { tags: ["home"] })).toBe(false);
    expect(inLens(work, { tags: [] })).toBe(false);
    expect(inLens({ rec: "g", name: "G", tags: ["δουλειά"], exclude: [], accent: null }, { tags: ["ΔΟΥΛΕΙΑ"] })).toBe(true);
  });
  it("is no filter without a lens", () => {
    expect(inLens(null, { tags: [] })).toBe(true);
    const all = [{ tags: ["a"] }];
    expect(withinLens(undefined, all)).toBe(all);
  });
  it("filters a list", () => {
    const a = { id: 1, tags: ["work"] }, b = { id: 2, tags: ["home"] };
    expect(withinLens(work, [a, b])).toEqual([a]);
  });
  it("leaves out anything with an excluded tag", () => {
    const hide: Lens = { rec: "h", name: "H", tags: [], exclude: ["archive"], accent: null };
    expect(inLens(hide, { tags: [] })).toBe(true);
    expect(inLens(hide, { tags: ["work", "Archive"] })).toBe(false);
    const both: Lens = { ...work, exclude: ["done"], accent: null };
    expect(inLens(both, { tags: ["work"] })).toBe(true);
    expect(inLens(both, { tags: ["work", "done"] })).toBe(false);
    expect(lensFilter(both)).toBe("lens: Work (tags: work, Clients; not: done)");
    expect(lensFilter(hide)).toBe("lens: H (not: archive)");
    expect(lensTag(hide)).toBeUndefined();
  });
});

describe("a lens that is on", () => {
  it("is found by its record, or none when it is gone", () => {
    expect(activeLens([work], "w")).toBe(work);
    expect(activeLens([work], "x")).toBeNull();
    expect(activeLens([work], null)).toBeNull();
  });
  it("gives new items its first tag, once", () => {
    expect(lensTag(work)).toBe("work");
    expect(inheritTags(work, ["home"])).toEqual(["home", "work"]);
    expect(inheritTags(work, ["WORK"])).toEqual(["WORK"]);
    expect(inheritTags(work)).toEqual(["work"]);
    expect(inheritTags(null, ["home"])).toEqual(["home"]);
  });
  it("is told to the assistant, before the list's own filter", () => {
    expect(lensFilter(work)).toBe("lens: Work (tags: work, Clients)");
    expect(contextFilter(work, "milk")).toBe("lens: Work (tags: work, Clients) · milk");
    expect(contextFilter(null, "milk")).toBe("milk");
    expect(contextFilter(null, "")).toBeUndefined();
  });
});

describe("lenses calls", () => {
  const s = { url: "http://pb" };
  const fake = (reply: (url: string, init?: RequestInit) => unknown) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(reply(String(url), init)), { status: 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = real; } };
  };
  it("lists, creates, updates and removes", async () => {
    const f = fake((url, init) => (init?.method === "DELETE" ? {} : url.includes("?") ? { items: [{ id: "a", name: "Work", tags: ["work"] }] } : { id: "a", name: "Work", tags: ["work"] }));
    try {
      expect(await lenses.list(s)).toEqual([{ rec: "a", name: "Work", tags: ["work"], exclude: [], accent: null }]);
      expect((await lenses.create(s, { name: "Work", tags: ["work"], exclude: [], accent: null })).rec).toBe("a");
      await lenses.update(s, "a", { name: "Work", tags: ["work"], exclude: [], accent: null });
      await lenses.remove(s, "a");
      expect(f.calls.map((c) => `${c.init?.method ?? "GET"} ${c.url.replace("http://pb/api/", "").split("?")[0]}`)).toEqual([
        "GET collections/lenses/records", "POST collections/lenses/records", "PATCH collections/lenses/records/a", "DELETE collections/lenses/records/a",
      ]);
      expect(JSON.parse(String(f.calls[1].init!.body))).toEqual({ name: "Work", tags: ["work"], exclude: [], accent: "" });
    } finally { f.restore(); }
  });
});
