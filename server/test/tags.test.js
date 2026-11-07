// The tag describer's lib (pb_hooks/lib/tags.js): what it reads from a request, which notes it samples, what it asks
// DeepSeek and what it takes from the answer.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/tags.js";

describe("the request", () => {
  test("a tag, trimmed, or all", () => {
    expect(lib.input({ tag: "  Σπίτι " })).toEqual({ tag: "Σπίτι" });
    expect(lib.input({ all: true })).toEqual({ all: true });
    expect(lib.input({ all: true, tag: "x" })).toEqual({ all: true });
  });
  test("anything else is refused", () => {
    for (const b of [null, undefined, "x", {}, { tag: "" }, { tag: "  " }, { tag: 3 }, { all: "yes" }, { tag: "x".repeat(41) }])
      expect(() => lib.input(b)).toThrow(lib.Bad);
  });
});

describe("which notes", () => {
  const rows = [
    { path: "notes/a.md", tags: '["Home","x"]', updated: "2026-10-01 10:00:00.000Z" },
    { path: "notes/b.md", tags: '["Σπίτι"]', updated: "2026-10-03 10:00:00.000Z" },
    { path: "notes/c.md", tags: "[]", updated: "2026-10-05 10:00:00.000Z" },
    { path: "notes/d.md", tags: "", updated: "2026-10-06 10:00:00.000Z" },
    { path: "notes/e.md", tags: "not json", updated: "2026-10-07 10:00:00.000Z" },
    { path: "notes/f.md", tags: ["home"], updated: "2026-10-04 10:00:00.000Z" },
  ];
  test("the newest first, case and tonos ignored", () => {
    expect(lib.pick(rows, "home")).toEqual(["notes/f.md", "notes/a.md"]);
    expect(lib.pick(rows, "σπιτι")).toEqual(["notes/b.md"]);
    expect(lib.pick(rows, "nothing")).toEqual([]);
  });
  test("at most n", () => {
    expect(lib.pick(rows, "home", 1)).toEqual(["notes/f.md"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `notes/${i}.md`, tags: '["t"]', updated: String(1000 + i) }));
    expect(lib.pick(many, "t")).toHaveLength(lib.MAX_NOTES);
    expect(lib.pick(many, "t")[0]).toBe("notes/29.md");
  });
  test("tagsOf reads the column's JSON text or a list, and nothing else", () => {
    expect(lib.tagsOf('["a",3,"b"]')).toEqual(["a", "b"]);
    expect(lib.tagsOf(null)).toEqual([]);
    expect(lib.tagsOf('{"a":1}')).toEqual([]);
  });
});

describe("the sample", () => {
  const note = (body) => `---\ntitle: Garage door codes\ncreated: 2026-10-05\ntags: [home]\n---\n${body}`;
  test("title and the opening of the body, pictures dropped", () => {
    expect(lib.sample("notes/20261005-g.md", note("![x](../attachments/g/a.jpg)\n\nThe code is on the fridge.\n\n\n\nSecond.\n")))
      .toEqual({ title: "Garage door codes", excerpt: "The code is on the fridge.\n\nSecond." });
  });
  test("a long body is cut", () => {
    const s = lib.sample("notes/20261005-g.md", note("word ".repeat(400)));
    expect(s.excerpt.length).toBeLessThanOrEqual(lib.BODY_CHARS + 1);
    expect(s.excerpt.endsWith("…")).toBe(true);
  });
  test("a note with no body", () => {
    expect(lib.sample("notes/20261005-g.md", note(""))).toEqual({ title: "Garage door codes", excerpt: "" });
  });
});

describe("the question", () => {
  test("names the tag and numbers the notes; the system says what to write", () => {
    const q = lib.request("home", [{ title: "A", excerpt: "body a" }, { title: "B", excerpt: "" }]);
    expect(q.user).toBe("Tag: home\n\nNotes that carry it (2):\n\nNote 1: A\nbody a\n\nNote 2: B");
    expect(q.system).toContain(`${lib.MAX_CHARS} characters`);
    expect(q.system).toContain("not instructions");
  });
});

describe("the answer", () => {
  test("plain text as it is; fences, quotes and labels off, on one line", () => {
    expect(lib.descriptionOf("Household chores and repairs.")).toBe("Household chores and repairs.");
    expect(lib.descriptionOf("```\nHousehold chores.\nRepairs.\n```")).toBe("Household chores. Repairs.");
    expect(lib.descriptionOf('"Household chores."')).toBe("Household chores.");
    expect(lib.descriptionOf("**Description:** Household chores.")).toBe("Household chores.");
    expect(lib.descriptionOf("Περιγραφή: Δουλειές του σπιτιού.")).toBe("Δουλειές του σπιτιού.");
    expect(lib.descriptionOf('He said "a" and "b".')).toBe('He said "a" and "b".');
  });
  test("empty is a failure", () => {
    for (const a of ["", "  ", null, undefined]) expect(lib.descriptionOf(a)).toBeNull();
  });
  test("too long: cut after the last whole sentence that fits, else a failure", () => {
    const s1 = `${"a".repeat(150)}.`, s2 = `${"b".repeat(200)}.`, s3 = `${"c".repeat(100)}.`;
    expect(lib.descriptionOf(`${s1} ${s2} ${s3}`)).toBe(`${s1} ${s2}`);
    expect(lib.descriptionOf("x".repeat(500))).toBeNull();
    expect(lib.descriptionOf(`${s1} ${s2}`).length).toBeLessThanOrEqual(lib.MAX_CHARS);
  });
});

describe("the hourly description", () => {
  const rows = [{ tags: '["Σπίτι"]' }, { tags: '["σπιτι","x"]' }, { tags: "[]" }];
  test("counts the notes that carry a tag, case and tonos ignored", () => {
    expect(lib.count(rows, "ΣΠΊΤΙ")).toBe(2);
    expect(lib.count(rows, "none")).toBe(0);
  });
  test("is due once EVERY more notes carry it than when it was written", () => {
    expect(lib.EVERY).toBe(10);
    expect(lib.due(10, 0)).toBe(true);
    expect(lib.due(9, undefined)).toBe(false);
    expect(lib.due(24, 15)).toBe(false);
    expect(lib.due(25, 15)).toBe(true);
  });
});
