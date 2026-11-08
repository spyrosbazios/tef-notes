import { describe, expect, it } from "bun:test";
import { foundOf, FOUND_MAX } from "../src/find";

describe("foundOf", () => {
  it("keeps hits with a path or id, once each, at most FOUND_MAX", () => {
    const many = Array.from({ length: FOUND_MAX + 3 }, (_, i) => ({ id: `t${i}`, why: "x" }));
    const f = foundOf({ notes: [{ path: "notes/a.md", why: " fits " }, { path: "notes/a.md", why: "again" }, { why: "no path" }, 7], tasks: many });
    expect(f.notes).toEqual([{ path: "notes/a.md", why: "fits" }]);
    expect(f.tasks).toHaveLength(FOUND_MAX);
  });
  it("reads anything else as nothing found", () => {
    expect(foundOf(null)).toEqual({ notes: [], tasks: [] });
    expect(foundOf({ notes: "x" })).toEqual({ notes: [], tasks: [] });
  });
});
