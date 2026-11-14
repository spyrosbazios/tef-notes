import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { Notes } from "../src/notes";
import { Todo } from "../src/todo";
import { tools, toolPolicies, policyFor } from "../src/tools";
import { fromWeb } from "../src/tools";
import { stepTools } from "../src/loop";
import { policyApprovals, type PolicyContext } from "../src/tool-policy";

const names = (match: (name: string) => boolean) => Object.keys(toolPolicies()).filter(match).sort();
const result = (toolName: string, value: string): ModelMessage[] => [{
  role: "tool", content: [{ type: "tool-result", toolCallId: "call", toolName, output: { type: "json", value: { ref: value } } }],
}];

describe("colocated tool policies", () => {
  it("classifies every assembled tool exactly once", () => {
    // Constructing tools must not fetch anything; no live server or secrets are needed.
    const server = { url: "http://unused.invalid" };
    expect(Object.keys(toolPolicies()).sort()).toEqual(Object.keys(tools(new Notes(server), new Todo(server))).sort());
    expect(policyFor("old_removed_tool")).toBeUndefined();
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

  it("keeps Exa optional and withdraws only the existing unsafe tools", () => {
    expect(names((n) => policyFor(n)?.requiresExa === true)).toEqual(["read_url", "web_search"]);
    const all = Object.keys(toolPolicies());
    expect(all.filter((n) => !stepTools(all, true, policyFor).includes(n)).sort())
      .toEqual(["insert_after_selection", "replace_selection", "save_drawing", "update_memory"]);
    expect(stepTools(all, false, policyFor)).toEqual(all);
    expect(stepTools(["draw", "delete_note", "old_removed_tool"], true, policyFor)).toEqual(["draw", "delete_note", "old_removed_tool"]);
  });

  it("preserves approval modes, validator short-circuiting and the owner's setting", async () => {
    const context = {} as PolicyContext; // Synthetic validators below never access a server.
    for (const writesWithoutAsking of [false, true]) {
      for (const tainted of [false, true]) {
        let reads = 0;
        const approval = policyApprovals({
          read: { approval: "none", result: "plain" },
          write: { approval: "write", result: "plain" },
          always: { approval: "always", result: "plain" },
          memory: { approval: "tainted", result: "plain" },
          invalid: { approval: "write", result: "plain", check: async () => "invalid" },
        } as const, context, writesWithoutAsking, async () => { reads++; return tainted; });
        expect(Object.keys(approval).sort()).toEqual(["always", "invalid", "memory", "write"]);
        expect(await approval.invalid({}, { messages: [] })).toBe("not-applicable");
        expect(reads).toBe(0);
        expect(await approval.always({})).toBe("user-approval");
        expect(reads).toBe(0);
        expect(await approval.write({}, { messages: [] })).toBe(!writesWithoutAsking || tainted ? "user-approval" : "not-applicable");
        expect(await approval.memory({}, { messages: [] })).toBe(tainted ? "user-approval" : "not-applicable");
      }
    }
    expect(names((n) => policyFor(n)?.approval === "always")).toEqual(["attach_file", "delete_note", "delete_task"]);
    expect(names((n) => policyFor(n)?.approval === "tainted")).toEqual(["update_memory"]);
  });
});
