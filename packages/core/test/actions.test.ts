import { describe, expect, test } from "bun:test";
import { ACTIONS, actionsOf, DEFAULT_ACTIONS, decide, RULES } from "../src/actions";
import { DEFAULT_PREFS, isPrefPath, patchPaths, withPatch } from "../src/prefs";

describe("actions", () => {
  test("defaults are what the agent did before they were settings: everything asks but its memory", () => {
    expect(DEFAULT_ACTIONS).toEqual({
      createTask: "ask", editTask: "ask", deleteTask: "ask", createNote: "ask", editNote: "ask", deleteNote: "ask",
      files: "ask", tags: "ask", noteActions: "ask", memory: "auto",
    });
    expect(DEFAULT_PREFS.actions).toEqual(DEFAULT_ACTIONS);
  });

  test("a stored value is read defensively", () => {
    expect(actionsOf(undefined)).toEqual(DEFAULT_ACTIONS);
    expect(actionsOf(["ask"])).toEqual(DEFAULT_ACTIONS);
    expect(actionsOf({ memory: "never", files: "maybe" })).toEqual({ ...DEFAULT_ACTIONS, memory: "never" });
  });

  test("ask always asks, auto asks only when tainted, never refuses", () => {
    for (const tainted of [false, true]) {
      expect(decide("ask", tainted)).toBe("ask");
      expect(decide("auto", tainted)).toBe(tainted ? "ask" : "go");
      expect(decide("never", tainted)).toBe("refuse");
    }
  });

  test("each action is a preference path of its own, so devices changing different ones never undo each other's", () => {
    for (const a of ACTIONS) expect(isPrefPath(`actions.${a}`)).toBe(true);
    expect(patchPaths({ actions: { createNote: "auto" } })).toEqual(["actions.createNote"]);
    const p = withPatch(DEFAULT_PREFS, { actions: { createNote: "auto" } });
    expect(p.actions).toEqual({ ...DEFAULT_ACTIONS, createNote: "auto" });
    expect(RULES).toEqual(["ask", "auto", "never"]);
  });
});
