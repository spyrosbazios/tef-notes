import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { NoteService } from "../src/application/notes";
import { TaskService } from "../src/application/todo";
import { fromWeb, MODULES, tools, toolPolicies, policyFor } from "../src/tools";
import { stepTools } from "../src/loop";
import { offeredTo, outOfScope, type Scope } from "../src/note-action";
import { allowed, policyApprovals, type Policy, type PolicyContext } from "../src/tool-policy";
import { ACTIONS, DEFAULT_ACTIONS, isAction, RULES, type Actions } from "@/core/actions";
import type { Result } from "@/core/note-actions";
import { WRITE_TOOLS } from "@/core/tool-words";

const names = (match: (name: string) => boolean) => Object.keys(toolPolicies()).filter(match).sort();
const result = (toolName: string, value: string): ModelMessage[] => [{
  role: "tool", content: [{ type: "tool-result", toolCallId: "call", toolName, output: { type: "json", value: { ref: value } } }],
}];

describe("colocated tool policies", () => {
  it("classifies every assembled tool exactly once", () => {
    // Constructing tools must not fetch anything; no live server or secrets are needed.
    const server = { url: "http://unused.invalid" };
    expect(Object.keys(toolPolicies()).sort()).toEqual(Object.keys(tools(new NoteService(server), new TaskService(server))).sort());
    expect(policyFor("old_removed_tool")).toBeUndefined();
  });

  it("registers each tool in one module only, every write under one of core's actions", () => {
    const deps = { notes: new NoteService({ url: "http://unused.invalid" }), todo: new TaskService({ url: "http://unused.invalid" }), fromPage: async () => false, files: [] };
    const each = MODULES.flatMap((m) => Object.keys(m.tools(deps)));
    expect(each.length).toBe(new Set(each).size);
    for (const m of MODULES) expect(Object.keys(m.policies).sort()).toEqual(Object.keys(m.tools(deps)).sort());
    for (const [name, p] of Object.entries(toolPolicies() as Record<string, Policy>)) {
      if (p.approval !== "none") expect([name, isAction(p.approval)]).toEqual([name, true]);
    }
    // The writes are the ones the clients have a confirm card's words for (@/core/tool-words)
    expect(names((n) => policyFor(n)?.approval !== "none")).toEqual([...WRITE_TOOLS].sort());
  });

  it("offers Talk all but what needs a selection or a chat's file", () => {
    expect(names((n) => policyFor(n)?.unavailableInTalk === true))
      .toEqual(["attach_file", "insert_after_selection", "replace_selection"]);
  });

  it("offers a note action's run only the tools its result needs, and narrows its writes to its note", () => {
    const scope = (result: Result): Scope => ({ action: { id: "a", label: "A", icon: "sparkles", prompt: "p", result }, note: "notes/a.md" });
    const offered = (result: Result) => names((n) => offeredTo(scope(result), policyFor(n)));
    const reads = ["list_notes", "list_tags", "read_attachment", "read_drawing", "read_image", "read_note", "search_notes"];
    expect(offered("edit")).toEqual([...reads, "append_to_note", "rewrite_note"].sort());
    expect(offered("task")).toEqual([...reads, "add_task", "find_place", "list_tagged", "list_tasks", "set_place"].sort());
    expect(offered("answer")).toEqual([...reads, "list_tagged", "list_tasks"].sort());
    const edit = scope("edit");
    expect(outOfScope(edit, policyFor("rewrite_note"), { path: "notes/b.md" })).toContain("no other note");
    expect(outOfScope(edit, policyFor("append_to_note"), { path: "notes/a.md" })).toBeNull();
    expect(outOfScope(edit, policyFor("add_task"), { title: "x" })).toContain("notes/a.md");
    expect(outOfScope(edit, policyFor("add_task"), { title: "x", link: ["notes/a.md"] })).toBeNull();
    expect(outOfScope(edit, policyFor("read_note"), { path: "notes/b.md" })).toBeNull();
  });

  it("preserves which results taint directly and which follow record provenance", () => {
    const foreign = ["find_place", "read_attachment", "read_image", "read_page", "read_url", "web_search"];
    const records = ["list_notes", "list_tagged", "list_tasks", "read_drawing", "read_note", "search_notes",
      "show_day", "show_drawing", "show_items", "show_lens", "show_notes", "show_quote", "show_review", "show_tasks", "show_week"];
    expect(names((n) => policyFor(n)?.result === "untrusted")).toEqual(foreign.sort());
    expect(names((n) => policyFor(n)?.result === "records")).toEqual(records.sort());
    for (const n of Object.keys(toolPolicies())) {
      expect(fromWeb(result(n, "notes/a.md"))).toBe(foreign.includes(n));
      expect(fromWeb(result(n, "notes/a.md"), new Set(["notes/a.md"]))).toBe(foreign.includes(n) || records.includes(n));
    }
  });

  it("keeps Exa optional and withdraws only the unsafe tools", () => {
    expect(names((n) => policyFor(n)?.requiresExa === true)).toEqual(["read_url", "web_search"]);
    const all = Object.keys(toolPolicies());
    expect(all.filter((n) => !stepTools(all, true, policyFor).includes(n)).sort())
      .toEqual(["insert_after_selection", "replace_selection", "save_drawing", "save_note_action", "update_memory"]);
    expect(stepTools(all, false, policyFor)).toEqual(all);
    expect(stepTools(["draw", "delete_note", "old_removed_tool"], true, policyFor)).toEqual(["draw", "delete_note", "old_removed_tool"]);
  });

  it("follows the owner's rule per action; a failed check is refused with its reason; a tainted turn asks even when allowed", async () => {
    const context = {} as PolicyContext; // Synthetic validators below never access a server.
    for (const rule of RULES) {
      for (const tainted of [false, true]) {
        let reads = 0;
        const rules: Actions = { ...DEFAULT_ACTIONS, createNote: rule };
        const approval = policyApprovals({
          read: { approval: "none", result: "plain" },
          write: { approval: "createNote", result: "plain" },
          invalid: { approval: "createNote", result: "plain", check: async () => "invalid" },
        } as const, context, rules, async () => { reads++; return tainted; });
        expect(Object.keys(approval).sort()).toEqual(["invalid", "write"]);
        const write = await approval.write({}, { messages: [] });
        if (rule === "never") {
          expect(write).toEqual({ type: "denied", reason: expect.stringContaining("Create notes") });
          expect(await approval.invalid({}, { messages: [] })).toMatchObject({ type: "denied" });
        } else {
          expect(write).toBe(rule === "ask" || tainted ? "user-approval" : "not-applicable");
          expect(await approval.invalid({}, { messages: [] })).toEqual({ type: "denied", reason: "invalid" });
        }
        // "ask" never consults the history: nothing in the turn can talk it out of the card
        expect(reads).toBe(rule === "auto" ? 1 : 0);
      }
    }
  });

  it("an \"Ask first\" write always gets its card: every write tool, whatever the turn holds", async () => {
    const context = {} as PolicyContext;
    const writes = Object.fromEntries(Object.entries(toolPolicies()).filter(([, p]) => p.approval !== "none")
      .map(([n, p]) => [n, { approval: p.approval, result: p.result }])) as Record<string, Policy<unknown>>;
    const askAll = Object.fromEntries(ACTIONS.map((a) => [a, "ask"])) as Actions;
    const approval = policyApprovals(writes, context, askAll, async () => false) as Record<string, (i: unknown, o: { messages: ModelMessage[] }) => Promise<unknown>>;
    for (const n of Object.keys(writes)) expect(await approval[n]({}, { messages: [] })).toBe("user-approval");
  });

  it("files every write tool under an action; the defaults are what the agent did before they were settings", async () => {
    const byAction = (a: string) => names((n) => policyFor(n)?.approval === a);
    expect(Object.fromEntries(ACTIONS.map((a) => [a, byAction(a)]))).toEqual({
      createTask: ["add_task", "add_tasks"],
      editTask: ["complete_task", "set_place", "update_task"],
      deleteTask: ["delete_task"],
      createNote: ["create_note"],
      editNote: ["append_to_note", "rewrite_note", "set_note_flags", "summarise_links"],
      deleteNote: ["delete_note"],
      files: ["attach_file"],
      tags: ["create_lens", "create_tag", "update_tag"],
      noteActions: ["save_note_action"],
      memory: ["update_memory"],
    });
    // Before: notes, tasks, tags and lenses asked unless "write without asking" was on; deletes and files always asked;
    // memory asked only once the turn was tainted. Every rule but memory's defaults to "ask", memory's to "auto".
    expect(ACTIONS.filter((a) => DEFAULT_ACTIONS[a] !== "ask")).toEqual(["memory"]);
  });

  it("withdraws a write the owner never allows", () => {
    const rules: Actions = { ...DEFAULT_ACTIONS, deleteNote: "never" };
    expect(Object.keys(toolPolicies()).filter((n) => !allowed(policyFor(n), rules))).toEqual(["delete_note"]);
    expect(Object.keys(toolPolicies()).every((n) => allowed(policyFor(n), DEFAULT_ACTIONS))).toBe(true);
    expect(allowed(undefined, rules)).toBe(true);
  });
});
