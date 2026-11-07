// lib/rev.js, the compare-and-swap rev.pb.js enforces on notes and tasks.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/rev.js";

const { COLLECTIONS, refusal } = lib;

describe("refusal", () => {
  test("the rev it was based on goes ahead, as a number or as the query's string", () => {
    expect(refusal("tasks", "edit", 3, 3)).toBeNull();
    expect(refusal("notes", "delete", "3", 3)).toBeNull();
  });
  test("a stale rev is a 409 naming the record", () => {
    expect(refusal("tasks", "edit", 2, 3)).toEqual([409, "This task changed since that version."]);
    expect(refusal("notes", "delete", "4", 3)).toEqual([409, "This note changed since that version."]);
  });
  test("no rev is a 400", () => {
    for (const base of [undefined, null, ""]) expect(refusal("tasks", "edit", base, 1)?.[0]).toBe(400);
    expect(refusal("tasks", "delete", "", 1)).toEqual([400, "rev is required: the version this delete was based on."]);
  });
  test("covers every collection the clients edit", () => {
    expect(COLLECTIONS.sort()).toEqual(["notes", "tasks"]);
  });
});
