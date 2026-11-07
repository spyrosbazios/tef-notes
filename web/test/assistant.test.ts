// The docked assistant's side of the page: the context a request carries, the UI tools done through the nav, when a turn
// resumes by itself, and what a Stop leaves. The contract's own reading of the context is tested in packages/core.
import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { choiceOutput, UI_OK } from "@/core/assistant";
import { assistantView, closeUnfinished, isAppTool, pageContext, resumes, runUiTool, uiWords, webView, type UiHost } from "@/lib/assistant";
import type { View } from "@/lib/nav";
import { withNote, type NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

const note = (path: string, title: string, rev = 3): NoteRec =>
  withNote({ rec: "r1", path, rev, kind: "note", text: `---\ntitle: ${title}\n---\nbody`, updated: "" } as never);
const garage = note("notes/garage.md", "Garage", 7);
const task = { id: "t1", title: "Fix the door", done: "", rev: 1 } as unknown as TaskRec;
const held = { notes: [garage], tasks: [task] };

describe("the page context", () => {
  test("every note view is Home, a tag's filtered to it; the chat is no view", () => {
    expect(assistantView({ kind: "home" })).toEqual({ kind: "home" });
    expect(assistantView({ kind: "home", tags: ["x"] })).toEqual({ kind: "tag", tag: "x" });
    expect(assistantView({ kind: "home", tags: ["x", "y"] })).toEqual({ kind: "home" });
    expect(webView({ kind: "notes" })).toEqual({ kind: "home" });
    expect(webView({ kind: "pinned" })).toEqual({ kind: "home" });
    expect(webView({ kind: "tag", tag: "x" })).toEqual({ kind: "home", tags: ["x"] });
    expect(webView({ kind: "ask" })).toBeNull();
  });

  test("a lens that is on goes as the filter, and none sets none", () => {
    const work = { rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null };
    expect(pageContext({ view: { kind: "home" } }, held, "", work).filter).toBe("lens: Work (tags: work, clients)");
    expect(pageContext({ view: { kind: "home" } }, held, "", null).filter).toBeUndefined();
    expect(pageContext({ view: { kind: "home" } }, held, "").filter).toBeUndefined();
  });

  test("the open note, with the rev held", () => {
    const c = pageContext({ view: { kind: "home" }, open: garage.note.id }, held, "");
    expect(c).toEqual({ client: "web", view: { kind: "home" }, note: { path: "notes/garage.md", title: "Garage", rev: 7 } });
  });

  test("the open task, in a task list; an open note hides it", () => {
    expect(pageContext({ view: { kind: "today" }, task: "t1" }, held, "")).toEqual({ client: "web", view: { kind: "today" }, task: { id: "t1", title: "Fix the door" } });
    expect(pageContext({ view: { kind: "today" }, task: "t1", open: garage.note.id }, held, "").task).toBeUndefined();
  });

  test("the open note counts; a record not held is left out; the selection is trimmed", () => {
    expect(pageContext({ view: { kind: "home" }, open: garage.note.id }, held, "").note).toEqual({ path: "notes/garage.md", title: "Garage", rev: 7 });
    expect(pageContext({ view: { kind: "home" }, open: "gone" }, held, "").note).toBeUndefined();
    expect(pageContext({ view: { kind: "home" } }, held, "  some text  ").selection).toBe("some text");
    expect(pageContext({ view: { kind: "home" } }, held, "   ").selection).toBeUndefined();
  });
});

function host() {
  const did: string[] = [];
  const h: UiHost = {
    note: async (path) => held.notes.find((n) => n.path === path),
    task: async (id) => held.tasks.find((t) => t.id === id),
    nav: {
      openNote: (id) => did.push(`note ${id}`),
      showTask: (v: View, id) => did.push(`task ${id} in ${v.kind}`),
      goView: (v: View) => did.push(`view ${v.kind}${v.kind === "home" && v.tags ? ` ${v.tags.join(",")}` : ""}`),
    },
    showAssistant: () => did.push("assistant"),
  };
  return { h, did };
}

describe("the UI tools", () => {
  test("open a note, an open task in the Inbox", async () => {
    const { h, did } = host();
    expect(await runUiTool("open_note", { path: "notes/garage.md" }, h)).toEqual(UI_OK);
    expect(await runUiTool("open_task", { id: "t1" }, h)).toEqual(UI_OK);
    expect(did).toEqual([`note ${garage.note.id}`, "task t1 in inbox"]);
  });

  test("go to a view; to the chat opens the dock", async () => {
    const { h, did } = host();
    expect(await runUiTool("go_view", { view: "notes" }, h)).toEqual(UI_OK);
    expect(await runUiTool("go_view", { view: "tag", tag: "#home" }, h)).toEqual(UI_OK);
    expect(await runUiTool("go_view", { view: "ask" }, h)).toEqual(UI_OK);
    expect(did).toEqual(["view home", "view home home", "assistant"]);
  });

  test("what can't be done is answered with an error, never left open", async () => {
    const { h, did } = host();
    expect(await runUiTool("open_note", { path: "notes/nope.md" }, h)).toHaveProperty("error");
    expect(await runUiTool("open_note", { path: "../etc" }, h)).toHaveProperty("error");
    expect(await runUiTool("open_task", {}, h)).toHaveProperty("error");
    expect(await runUiTool("go_view", { view: "tag" }, h)).toHaveProperty("error");
    expect(await runUiTool("go_view", { view: "nowhere" }, h)).toHaveProperty("error");
    expect(did).toEqual([]);
  });

  test("a row's words", () => {
    expect(uiWords("open_note", { path: "notes/garage.md" }, "Garage")).toBe("Opened note “Garage”");
    expect(uiWords("go_view", { view: "today" }, undefined)).toBe("Went to Today");
    expect(uiWords("go_view", { view: "ask" }, undefined)).toBe("Opened the assistant");
  });
});

const tool = (type: string, state: string, extra: object = {}) => ({ type, toolCallId: `${type}-${state}`, state, input: {}, ...extra });
const reply = (...parts: object[]): UIMessage[] => [
  { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
  { id: "a", role: "assistant", parts: [{ type: "step-start" }, ...parts] as UIMessage["parts"] },
];

describe("resuming by itself", () => {
  test("after a UI tool's answer", () => {
    expect(resumes({ messages: reply(tool("tool-open_note", "output-available", { output: UI_OK })) })).toBe(true);
    expect(resumes({ messages: reply(tool("tool-open_note", "input-available")) })).toBe(false);
  });

  test("after the owner answers a question, not while it waits", () => {
    const input = { question: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
    expect(resumes({ messages: reply(tool("tool-ask_choice", "input-available", { input })) })).toBe(false);
    expect(resumes({ messages: reply(tool("tool-ask_choice", "output-available", { input, output: choiceOutput(["a"]) })) })).toBe(true);
  });

  test("the question is the owner's to answer, not an app tool", () => {
    expect(isAppTool("ask_choice")).toBe(false);
    expect(isAppTool("open_note")).toBe(true);
    expect(isAppTool("search_notes")).toBe(false);
  });

  test("not after server calls alone: a reply stopped at the step limit stays stopped", () => {
    expect(resumes({ messages: reply(tool("tool-search_notes", "output-available", { output: [] })) })).toBe(false);
  });

  test("after a card's answer", () => {
    const card = tool("tool-create_note", "approval-responded", { approval: { id: "x", approved: true } });
    expect(resumes({ messages: reply(card) })).toBe(true);
  });
});

describe("what a Stop leaves", () => {
  test("an open call is closed as failed, one still streaming dropped, the rest kept as they are", () => {
    const ms = reply({ type: "text", text: "ok" }, tool("tool-open_note", "input-available"), tool("tool-read_note", "input-streaming"));
    const [, a] = closeUnfinished(ms);
    expect(a.parts.map((p) => ("state" in p ? p.state : p.type))).toEqual(["step-start", "text", "output-error"]);
    const done = reply({ type: "text", text: "ok" });
    expect(closeUnfinished(done)).toBe(done);
  });
});
