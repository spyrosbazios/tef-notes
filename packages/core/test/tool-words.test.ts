// The words a chat shows for each agent tool (server/agent/src/todoTools.ts and notes.ts are the authority on the inputs).
import { describe, expect, it } from "bun:test";
import { CONFIRM, detailOf, isWriteTool, WRITE_TOOLS, type Preview } from "../src/tool-words";

const named = { note: "Shopping", task: "“Swim”" };
const textOf = (p: Preview) => (p.kind === "text" ? p.text.split("\n") : []);

describe("task cards", () => {
  it("name the record by the title the agent gave", () => {
    expect(CONFIRM.add_task({ title: "Call plumber" }, named)).toMatchObject({ head: "Add task “Call plumber”?", yes: "Add it", subject: "“Call plumber”" });
    expect(CONFIRM.update_task({ id: "x", about: "Call plumber" }, named)).toMatchObject({ head: "Change “Call plumber”?", done: "Changed" });
    expect(CONFIRM.complete_task({ id: "x", about: "Bins" }, named)).toMatchObject({ head: "Complete “Bins”?", done: "Completed" });
    expect(CONFIRM.complete_task({ id: "x", about: "Bins", done: false }, named)).toMatchObject({ head: "Reopen “Bins”?", skipped: "reopen" });
    expect(CONFIRM.delete_task({ id: "x", about: "Bins" }, named)).toMatchObject({ head: "Delete “Bins”?", yes: "Delete it" });
    expect(CONFIRM.delete_task({ id: "x" }, named).head).toBe("Delete a task?");
  });

  it("add_task: dates, where it goes, the checklist", () => {
    expect(textOf(CONFIRM.add_task({ title: "Lidl", when: "2026-11-01", evening: true, checklist: ["milk", "eggs"] }, named).preview))
      .toEqual(["2026-11-01, this evening", "In the Inbox", "Checklist: milk, eggs"]);
    expect(textOf(CONFIRM.add_task({ title: "Book", link: ["notes/a.md", "notes/b.md"] }, named).preview)).toEqual(["No day", "In the Inbox", "About notes/a.md, notes/b.md"]);
  });

  it("update_task: only what changes, null as its own words, nothing as no change", () => {
    expect(textOf(CONFIRM.update_task({ id: "x", when: null, due: "2026-11-05", checklist: { add: ["pay"], remove: ["ab12"] } }, named).preview))
      .toEqual(["No day · due 2026-11-05", "Add to the checklist: pay", "Remove 1 checklist item"]);
    expect(textOf(CONFIRM.update_task({ id: "x" }, named).preview)).toEqual(["No change"]);
    expect(textOf(CONFIRM.update_task({ id: "x", link: ["notes/a.md"], unlink: ["notes/b.md"] }, named).preview)).toEqual(["Link notes/a.md", "Unlink notes/b.md"]);
  });

  it("ticks and deletes", () => {
    expect(textOf(CONFIRM.complete_task({ id: "x" }, named).preview)).toEqual(["Mark it done"]);
    expect(textOf(CONFIRM.complete_task({ id: "x", done: false }, named).preview)).toEqual(["Open it again"]);
    expect(textOf(CONFIRM.delete_task({ id: "x" }, named).preview)).toEqual(["Delete it for good"]);
  });
});

describe("note cards", () => {
  it("name the note as the client holds it, and say what the body shows", () => {
    expect(CONFIRM.append_to_note({ path: "notes/a.md", text: "milk", section: "Today" }, named))
      .toMatchObject({ head: "Add to Shopping?", yes: "Add it", preview: { kind: "append" }, notes: ["Under “Today”"] });
    expect(CONFIRM.create_note({ title: "Trip", body: "- pack", pinned: true }, named)).toMatchObject({ preview: { kind: "markdown", body: "- pack" }, notes: ["Pinned"] });
    expect(CONFIRM.set_place({ task: "t", clear: true }, named).head).toBe("Remove the place of “Swim”?");
    expect(CONFIRM.update_memory({}, named).warning).toBeTruthy();
  });

  it("covers every write tool with words of its own", () => {
    for (const n of WRITE_TOOLS) {
      const c = CONFIRM[n]({}, named);
      expect([n, c.head.endsWith("?"), !!c.yes, !!c.done, !!c.skipped]).toEqual([n, true, true, true, true]);
      expect(isWriteTool(n)).toBe(true);
    }
    expect(isWriteTool("read_note")).toBe(false);
  });
});

describe("the line beside a call", () => {
  const titleOf = (p: unknown) => (p === "notes/a.md" ? "Shopping" : String(p));
  it("says what it looked for or which note, and nothing for a tool that isn't one any more", () => {
    expect(detailOf("search_notes", { query: "milk" }, titleOf)).toBe("milk");
    expect(detailOf("read_note", { path: "notes/a.md" }, titleOf)).toBe("Shopping");
    expect(detailOf("show_items", {}, titleOf)).toBe("");
    expect(detailOf("old_removed_tool", { query: "x" }, titleOf)).toBe("");
  });
});
