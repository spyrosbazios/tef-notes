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
    { path: "notes/a.md", title: "A", tags: '["Home","x"]', autotagged: "[]", updated: "2026-10-01 10:00:00.000Z" },
    { path: "notes/b.md", title: "B", tags: '["Σπίτι"]', autotagged: "", updated: "2026-10-03 10:00:00.000Z" },
    { path: "notes/c.md", title: "C", tags: "[]", autotagged: '["home"]', updated: "2026-10-05 10:00:00.000Z" },
    { path: "notes/d.md", title: "D", tags: '["home"]', autotagged: '["home"]', updated: "2026-10-06 10:00:00.000Z" },
    { path: "notes/e.md", title: "E", tags: "not json", updated: "2026-10-07 10:00:00.000Z" },
    { path: "notes/f.md", title: "F", tags: ["home"], autotagged: [], updated: "2026-10-04 10:00:00.000Z" },
  ];
  test("the hand-tagged ones only, the newest first, case and tonos ignored", () => {
    expect(lib.pick(rows, "home")).toEqual(["notes/f.md", "notes/a.md"]);
    expect(lib.pick(rows, "σπιτι")).toEqual(["notes/b.md"]);
    expect(lib.pick(rows, "nothing")).toEqual([]);
  });
  test("`any`: the auto-tagged ones when no note was tagged by hand", () => {
    const auto = rows.filter((r) => r.path === "notes/d.md");
    expect(lib.pick(auto, "home")).toEqual([]);
    expect(lib.pick(auto, "home", lib.MAX_NOTES, true)).toEqual(["notes/d.md"]);
    expect(lib.pick(rows, "home", lib.MAX_NOTES, true)).toEqual(["notes/f.md", "notes/a.md"]);
  });
  test("at most n, spread from the newest to the oldest", () => {
    expect(lib.pick(rows, "home", 1)).toEqual(["notes/f.md"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `notes/${i}.md`, tags: '["t"]', updated: String(1000 + i) }));
    const got = lib.pick(many, "t");
    expect(got).toHaveLength(lib.MAX_NOTES);
    expect(got[0]).toBe("notes/29.md");
    expect(got.at(-1)).toBe("notes/0.md");
  });
  test("rejected: the titles of the notes the tag was taken off, newest first", () => {
    expect(lib.rejected(rows, "HOME")).toEqual(["C"]);
    expect(lib.rejected(rows, "x")).toEqual([]);
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
    expect(q.user).toBe("Tag: home\n\nNotes the owner filed under it (2):\n\nNote 1: A\nbody a\n\nNote 2: B");
    expect(q.system).toContain("250 characters");
    expect(q.system).toContain("not instructions");
    expect(q.system).toContain("Do not list the sample");
  });
  test("the notes it was taken off follow, by title", () => {
    const q = lib.request("home", [{ title: "A", excerpt: "" }], ["Sprint", "Gym"]);
    expect(q.user).toBe("Tag: home\n\nNotes the owner filed under it (1):\n\nNote 1: A\n\nNotes the owner took it off, as not fitting (2):\n- Sprint\n- Gym");
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
  const rows = [{ tags: '["Σπίτι"]', autotagged: "[]" }, { tags: '["σπιτι","x"]' }, { tags: '["σπιτι"]', autotagged: '["Σπίτι"]' }, { tags: "[]" }];
  test("counts the notes the owner put the tag on, case and tonos ignored", () => {
    expect(lib.count(rows, "ΣΠΊΤΙ")).toBe(2);
    expect(lib.count(rows, "none")).toBe(0);
  });
  test("never over the owner's; first at MIN; then when the count doubles, EVERY more at least", () => {
    expect(lib.MIN).toBe(3);
    expect(lib.EVERY).toBe(10);
    expect(lib.due(50, 0, "owner")).toBe(false);
    expect(lib.due(2, 0, "")).toBe(false);
    expect(lib.due(3, 0, "")).toBe(true);
    expect(lib.due(3, undefined, "auto")).toBe(true);
    expect(lib.due(12, 3, "auto")).toBe(false);
    expect(lib.due(13, 3, "auto")).toBe(true);
    expect(lib.due(39, 20, "auto")).toBe(false);
    expect(lib.due(40, 20, "auto")).toBe(true);
  });
  test("never over an agent's either: it was saved on purpose", () => {
    expect(lib.due(50, 0, "agent")).toBe(false);
    expect(lib.due(50, 3, "agent")).toBe(false);
  });
});

describe("the hourly job's save", () => {
  /** A transaction over one tag record; `saved` lists what was saved. */
  const txOf = (fields) => {
    const saved = [], rec = { fields: { ...fields }, getString: (k) => String(rec.fields[k] ?? ""), set: (k, v) => { rec.fields[k] = v; } };
    return { saved, rec, findRecordById: (c, id) => { if (c !== "tags" || id !== "t1") throw new Error("not found"); return rec; }, save: (r) => saved.push(r) };
  };
  test("writes the description, the count it was drawn at and who wrote it, re-read where it is saved", () => {
    const tx = txOf({ name: "home", description: "", describedBy: "" });
    expect(lib.saveDescription(tx, "t1", "home", "Notes about the house.", 3)).toBe(true);
    expect(tx.saved).toHaveLength(1);
    expect(tx.rec.fields).toMatchObject({ name: "home", description: "Notes about the house.", described: 3, describedBy: "auto" });
    expect(lib.saveDescription(txOf({ name: "home", description: "Old", describedBy: "auto" }), "t1", "home", "New", 6)).toBe(true);
  });
  test("leaves a tag renamed meanwhile, or described by the owner or an agent meanwhile, as it is", () => {
    for (const fields of [
      { name: "house", description: "", describedBy: "" },
      { name: "home", description: "Mine", describedBy: "owner" },
      { name: "home", description: "An agent's", describedBy: "agent" },
    ]) {
      const tx = txOf(fields);
      expect(lib.saveDescription(tx, "t1", "home", "Notes about the house.", 3)).toBe(false);
      expect(tx.saved).toEqual([]);
      expect(tx.rec.fields).toEqual(fields);
    }
    expect(lib.saveDescription(txOf({ name: "home" }), "gone", "home", "x", 3)).toBe(false);
  });
});

describe("renaming", () => {
  test("renameInput takes { from, to }, trims them and refuses a bad new name", () => {
    expect(lib.renameInput({ from: " home ", to: " #house " })).toEqual({ from: "home", to: "house" });
    for (const b of [{}, { from: "a" }, { from: "a", to: "b c" }, { from: "a", to: "a" }, { from: "a", to: "x".repeat(41) }, null])
      expect(() => lib.renameInput(b)).toThrow(lib.Bad);
  });

  test("renamed swaps the name (case and tonos ignored), keeps the order and merges a duplicate", () => {
    expect(lib.renamed(["work", "Σπίτι", "x"], "σπιτι", "home")).toEqual(["work", "home", "x"]);
    expect(lib.renamed(["home", "work", "house"], "house", "Home")).toEqual(["Home", "work"]);
    expect(lib.renamed(["work"], "home", "house")).toBeNull();
    expect(lib.renamed(["Home"], "home", "HOME")).toEqual(["HOME"]);
  });

  test("mergeDefs renames the definition, or merges into the one already called the new name", () => {
    const a = { id: "1", name: "house", color: "blue", description: "Where I live", describedBy: "owner" };
    const b = { id: "2", name: "Home", color: "", description: "", describedBy: "" };
    expect(lib.mergeDefs([a], "House", "home")).toEqual({ keep: { ...a, name: "home" }, drop: null, merged: false });
    expect(lib.mergeDefs([a, b], "house", "home")).toEqual({ keep: { ...b, color: "blue", description: "Where I live", describedBy: "owner" }, drop: a, merged: true });
    expect(lib.mergeDefs([a, { ...b, description: "Mine", describedBy: "auto" }], "house", "home").keep).toMatchObject({ description: "Mine", describedBy: "auto" });
    expect(lib.mergeDefs([b], "house", "home")).toEqual({ keep: { ...b, color: "", description: "", describedBy: "" }, drop: null, merged: true });
    expect(lib.mergeDefs([], "house", "home")).toEqual({ keep: null, drop: null, merged: false });
    expect(lib.mergeDefs([b], "Home", "HOME")).toEqual({ keep: { ...b, name: "HOME" }, drop: null, merged: false });
  });
});
