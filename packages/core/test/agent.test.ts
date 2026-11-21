import { describe, expect, it } from "bun:test";
import { cardKey, cardsByPart, cardsOf, gist, kindOf, label, noteCardOf, previewOf, taskCardOf } from "../src/agent";
import { newTask } from "../src/todo";
import { WIDGET_TOOLS } from "../src/widgets";

describe("labels", () => {
  it("every task tool is labelled and folded as tasks, not notes", () => {
    expect(label("update_task")).toBe("Changing a task");
    expect(kindOf("list_tasks")).toBe("tasks");
    expect(kindOf("add_task")).toBe("todo");
    expect(gist(["tasks", "todo", "todo"])).toBe("Read tasks · changed 2 tasks");
  });
  it("the widgets and the question are labelled; a widget is never folded away, free time is read as tasks", () => {
    for (const n of ["show_day", "show_week", "show_review", "show_quote", "show_link", "show_lens", "find_free_slots", "ask_choice"]) expect(label(n)).not.toBe(n);
    for (const n of WIDGET_TOOLS) expect(kindOf(n)).toBeUndefined();
    expect(kindOf("find_free_slots")).toBe("tasks");
  });
});

describe("cards", () => {
  const file = (body: string, extra = "") => `---\ntitle: Trip\ncreated: 2026-10-01\n${extra}---\n${body}`;

  it("a note's card: title, tags, the opening lines without its own title line, the first photo; unset parts left out", () => {
    const text = file("# Trip\nline one\n![x](../attachments/20261001-trip/p1.jpg)\n- [ ] pack\n", "tags: [home, work]\n");
    expect(noteCardOf("notes/20261001-trip.md", text)).toEqual({ kind: "note", path: "notes/20261001-trip.md", title: "Trip", tags: ["home", "work"],
      image: "p1.jpg", preview: "line one\n- [ ] pack" });
    expect(noteCardOf("notes/20261001-trip.md", file("just text\n"))).toEqual({ kind: "note", path: "notes/20261001-trip.md", title: "Trip", preview: "just text" });
    expect(noteCardOf("notes/20261001-trip.md", file("")).preview).toBe("");
  });

  it("previewOf: whole lines up to a few lines or characters; a cut inside a code block closes it", () => {
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    expect(previewOf(many, "x").split("\n")).toHaveLength(8);
    const wide = Array.from({ length: 10 }, () => "w".repeat(100)).join("\n");
    expect(previewOf(wide, "x").split("\n")).toHaveLength(4);
    expect(previewOf("```\n" + many + "\n```", "x")).toMatch(/^```\nline 0[\s\S]*line 6\n```$/);
    expect(previewOf("x".repeat(2000), "t").length).toBeLessThan(500);
  });

  it("a task's card: the fields a row shows, only what is set; checklist as ticked out of all", () => {
    const t = newTask("t1".padEnd(15, "0"), { title: "Pack", when: "2026-11-02", evening: true, due: "2026-11-05", every: "1w", checklist: [{ id: "a", text: "x", done: true }, { id: "b", text: "y", done: false }] });
    expect(taskCardOf(t)).toEqual({ kind: "task", id: t.id, title: "Pack", when: "2026-11-02", evening: true, due: "2026-11-05", every: "1w",
      checklist: [1, 2] });
    expect(taskCardOf(newTask("t2".padEnd(15, "0"), { title: "Loose", done: "2026-11-01" }))).toEqual({ kind: "task", id: "t2".padEnd(15, "0"), title: "Loose", done: "2026-11-01" });
  });

  it("cardsOf: a write's card or show_items' cards; anything else, or a malformed card, is none", () => {
    const note = noteCardOf("notes/a.md", file("x"));
    const task = taskCardOf(newTask("t1".padEnd(15, "0"), { title: "Pack" }));
    expect(cardsOf({ saved: "notes/a.md", rev: 2, card: note })).toEqual([note]);
    expect(cardsOf({ cards: [note, task, { kind: "task" }, { kind: "note", path: "agent/memory.md", title: "m" }, null, "x"] })).toEqual([note, task]);
    for (const x of [undefined, null, "x", 3, {}, { error: "no" }, { saved: "agent/memory.md", rev: 1 }, { card: { kind: "other", id: "x", title: "t" } }]) expect(cardsOf(x)).toEqual([]);
  });

  it("cardKey: a note by its path, a task by kind and id", () => {
    expect(cardKey({ kind: "note", path: "notes/a.md", title: "A", preview: "" })).toBe("notes/a.md");
    expect(cardKey({ kind: "task", id: "x", title: "A" })).toBe("task:x");
  });

  it("cardsByPart: the cards of finished tool parts by index; a record two parts carry is drawn under the last", () => {
    const a = noteCardOf("notes/a.md", file("x")), b = noteCardOf("notes/b.md", file("y")), t = taskCardOf(newTask("t1".padEnd(15, "0"), { title: "Pack" }));
    const parts = [{ type: "text" }, { state: "output-available", output: { cards: [a, b] } }, { state: "input-available", output: undefined },
      { state: "output-available", output: { saved: "notes/a.md", rev: 2, card: { ...a, title: "A2" } } }, { state: "output-available", output: { card: t } }, { state: "output-error" }];
    const by = cardsByPart(parts);
    expect([...by.keys()].sort()).toEqual([1, 3, 4]);
    expect(by.get(1)).toEqual([b]);
    expect(by.get(3)).toEqual([{ ...a, title: "A2" }]);
    expect(by.get(4)).toEqual([t]);
  });

  it("show_items is named, and is never folded into a summary", () => {
    expect(label("show_items")).toBe("Showing what it found");
    expect(kindOf("show_items")).toBeUndefined();
  });
});
