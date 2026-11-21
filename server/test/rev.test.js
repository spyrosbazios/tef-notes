// lib/rev.js, the compare-and-swap rev.pb.js enforces on notes, tasks, the preferences record and chats.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/rev.js";

const { COLLECTIONS, DELETES, refusal } = lib;

describe("refusal", () => {
  test("the rev it was based on goes ahead, as a number or as the query's string", () => {
    expect(refusal("tasks", "edit", 3, 3)).toBeNull();
    expect(refusal("notes", "delete", "3", 3)).toBeNull();
  });
  test("a stale rev is a 409 naming the record", () => {
    expect(refusal("tasks", "edit", 2, 3)).toEqual([409, "This task changed since that version."]);
    expect(refusal("notes", "delete", "4", 3)).toEqual([409, "This note changed since that version."]);
  });
  test("the preferences record is under it too", () => {
    expect(refusal("prefs", "edit", 1, 2)).toEqual([409, "This preferences record changed since that version."]);
    expect(refusal("prefs", "edit", 2, 2)).toBeNull();
  });
  test("no rev is a 400", () => {
    for (const base of [undefined, null, ""]) expect(refusal("tasks", "edit", base, 1)?.[0]).toBe(400);
    expect(refusal("tasks", "delete", "", 1)).toEqual([400, "rev is required: the version this delete was based on."]);
  });
  test("a chat's save is under it, named as a chat", () => {
    expect(refusal("chats", "edit", 0, 0)).toBeNull();                 // a chat from before the rev column reads as 0
    expect(refusal("chats", "edit", 1, 2)).toEqual([409, "This chat changed since that version."]);
  });
  test("covers every collection the clients and the agent edit; a chat's delete names no rev", () => {
    expect([...COLLECTIONS].sort()).toEqual(["chats", "notes", "prefs", "tasks"]);
    expect([...DELETES].sort()).toEqual(["notes", "prefs", "tasks"]);
  });
});
