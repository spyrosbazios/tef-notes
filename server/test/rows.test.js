// lib/rows.js: the one reader of a list column and the one spread, which the auto-tagger, the tag describer, the rename
// and the clip routes share; and every note's tags read once, over a fake database.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/rows.js";

describe("names", () => {
  test("reads the column's JSON text or a list, strings only", () => {
    expect(lib.names('["a",3,"b"]')).toEqual(["a", "b"]);
    expect(lib.names(["a", null, "b"])).toEqual(["a", "b"]);
  });
  test("anything else is none", () => {
    for (const raw of [null, undefined, "", "null", '{"a":1}', "not json", 7]) expect(lib.names(raw)).toEqual([]);
  });
});

describe("spread", () => {
  test("the first, the last and evenly between", () => {
    expect(lib.spread([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
    expect(lib.spread([1, 2], 3)).toEqual([1, 2]);
    expect(lib.spread([1, 2, 3], 1)).toEqual([1]);
  });
});

describe("noteTags", () => {
  test("every note under notes/ with its tags and the tagger's as lists", () => {
    let sql = "";
    globalThis.DynamicModel = class { constructor(f) { Object.assign(this, f); } };
    globalThis.arrayOf = (m) => { const a = []; a.model = m; return a; };
    const app = { db: () => ({ newQuery: (q) => ({ all: (out) => {
      sql = q;
      out.push({ id: "n1", path: "notes/a.md", title: "A", tags: '["home","x"]', autotagged: '["x"]', updated: "2026-11-01 10:00:00.000Z" });
    } }) }) };
    expect(lib.noteTags(app)).toEqual([{ id: "n1", path: "notes/a.md", title: "A", tags: ["home", "x"], autotagged: ["x"], updated: "2026-11-01 10:00:00.000Z" }]);
    expect(sql).toContain("WHERE path LIKE 'notes/%'");
  });
});
