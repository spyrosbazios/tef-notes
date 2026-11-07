// lib/links.js, what a `links` record must be (links.pb.js refuses the rest), against the clients' half
// (packages/core/src/record-links.ts): the same columns, the same refusals.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/links.js";
import * as core from "../../packages/core/src/record-links";

const get = (r) => (c) => r[c] ?? "";
const rec = (from, to, role = "about") => core.linkRecord({ id: "l1", from, to, role });
const T = { type: "task", id: "t1" }, N = { type: "note", id: "n1" }, N2 = { type: "note", id: "n2" };

describe("a link's shape", () => {
  test("the columns are the core's", () => {
    expect(lib.COLUMNS).toEqual(core.LINK_COLUMNS);
    expect(lib.TYPES).toEqual([...core.LINK_TYPES]);
    expect(lib.ROLES).toEqual([...core.LINK_ROLES]);
    for (const side of lib.SIDES) for (const t of lib.TYPES) expect(lib.column(side, t)).toBe(core.linkColumn(side, t));
  });
  test("one end a side and a role: what the core makes passes", () => {
    for (const [from, to, role] of [[T, N, "about"], [N, N2, "source"], [N2, T, "source"]]) expect(lib.refusal(get(rec(from, to, role)))).toBeNull();
  });
  test("refused, as the core refuses: no end or two on a side, an unknown role, one record to itself", () => {
    const ok = rec(T, N);
    const bad = [{ ...ok, fromTask: "" }, { ...ok, toNote: "" }, { ...ok, fromNote: "n9" }, { ...ok, role: "likes" }, { ...ok, role: "" }, { ...ok, fromTask: "", fromNote: "n1" }];
    for (const r of bad) {
      expect(lib.refusal(get(r))).toBeString();
      expect(core.linkOf(r)).toBeNull();
    }
    expect(lib.refusal(get({ ...ok, fromTask: "", fromNote: "n1" }))).toMatch(/itself/);
    expect(lib.refusal(get({ ...ok, toShot: "s9" }))).toMatch(/notes and tasks/);      // the gone captures' columns
  });
});
