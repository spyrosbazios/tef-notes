import { describe, expect, it } from "bun:test";
import { convertToModelMessages, tool, type ModelMessage, type UIMessage } from "ai";
import { z } from "zod";
import { capList, clip, fromWeb, repair, settle, withContext } from "../src/guard";

const msg = (parts: unknown[], role: UIMessage["role"] = "assistant") => ({ id: "m", role, parts }) as UIMessage;
const call = (state: string, input: unknown, extra: object = {}) => ({ type: "tool-get_stats", toolCallId: "c", state, input, ...extra });

describe("settle", () => {
  it("leaves a finished history alone, same array", () => {
    const ms = [msg([{ type: "text", text: "hi" }], "user"), msg([call("output-available", { range: "today" }, { output: 1 })])];
    expect(settle(ms)).toBe(ms);
  });
  it("fails a call that ran, drops one still streaming its input", () => {
    const [m] = settle([msg([call("input-available", { range: "today" }), call("input-streaming", undefined), { type: "text", text: "x" }])]);
    expect(m.parts).toEqual([{ ...call("input-available", { range: "today" }), state: "output-error", errorText: "Stopped before it finished." }, { type: "text", text: "x" }] as never);
  });

  it("closes an app tool the client never answered, saying so", () => {
    const open = { type: "tool-open_note", toolCallId: "c9", state: "input-available", input: { path: "notes/a.md" } };
    const [m] = settle([msg([open])]);
    expect(m.parts).toEqual([{ ...open, state: "output-error", errorText: "The app didn't do it." }] as never);
  });

  it("closes a question the owner never answered, saying so", () => {
    const open = { type: "tool-ask_choice", toolCallId: "c8", state: "input-available", input: { question: "When?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } };
    const [m] = settle([msg([open])]);
    expect(m.parts).toEqual([{ ...open, state: "output-error", errorText: "The owner didn't answer." }] as never);
  });

  const card = (id: string, state: string, approval: object) => ({ type: "tool-create_note", toolCallId: id, state, input: { title: "x", body: "" }, approval });
  const user = (text: string) => msg([{ type: "text", text }], "user");

  it("leaves the newest turn's confirm card live", () => {
    const ms = [user("note x"), msg([card("c1", "approval-requested", { id: "a1" })])];
    expect(settle(ms)).toBe(ms);
  });

  it("denies a card passed over for a new message, so the next request has a result for every call", async () => {
    const ms = [
      user("note x"),
      msg([card("c1", "approval-requested", { id: "a1" }), card("c2", "approval-responded", { id: "a2", approved: true }),
        card("c3", "approval-responded", { id: "a3", approved: false, reason: "User declined" })]),
      user("something else"),
    ];
    const out = settle(ms);
    expect(out[1].parts).toEqual([
      card("c1", "output-denied", { id: "a1", approved: false, reason: "Not confirmed." }),
      card("c2", "output-denied", { id: "a2", approved: false, reason: "Not confirmed." }),
      card("c3", "output-denied", { id: "a3", approved: false, reason: "User declined" }),
    ] as never);
    expect(ms[1].parts[0]).toMatchObject({ state: "approval-requested" });                // a copy
    const results = (await convertToModelMessages(out)).flatMap((m) => (m.role === "tool" ? m.content : []))
      .flatMap((p) => (p.type === "tool-result" ? [[p.toolCallId, p.output]] : []));
    expect(results).toEqual([
      ["c1", { type: "error-text", value: "Not confirmed." }], ["c2", { type: "error-text", value: "Not confirmed." }],
      ["c3", { type: "error-text", value: "User declined" }],
    ]);
  });
});

describe("withContext", () => {
  it("puts the context ahead of the newest user message's text only, the chat itself untouched", () => {
    const ms = [msg([{ type: "text", text: "a" }], "user"), msg([{ type: "text", text: "b" }]), msg([{ type: "text", text: "c" }], "user"),
      msg([call("approval-responded", { range: "all" }, { approval: { id: "x", approved: true } })])];
    const before = structuredClone(ms);
    const out = withContext(ms, "<context>now</context>");
    expect(ms).toEqual(before);
    expect(out[2].parts).toEqual([{ type: "text", text: "<context>now</context>" }, { type: "text", text: "c" }]);
    expect([out[0], out[1], out[3]]).toEqual([ms[0], ms[1], ms[3]]);
    expect(out[0]).toBe(ms[0]);
    expect(withContext([], "x")).toEqual([]);
  });
});

describe("repair", () => {
  const tools = { get_stats: tool({ inputSchema: z.object({ range: z.enum(["today", "all"]) }), execute: async () => 1 }) };
  it("returns a history that fits as it is", async () => {
    const ms = [msg([call("output-available", { range: "all" }, { output: 1 })])];
    expect(await repair(ms, tools)).toBe(ms);
  });
  it("turns a call whose input no longer fits into a line of text, keeping the rest", async () => {
    const ok = call("output-available", { range: "all" }, { output: 1 });
    const [m] = await repair([msg([ok, call("output-available", { window: "7d" }, { output: 2 })])], tools);
    expect(m.parts).toEqual([ok, { type: "text", text: "(An earlier get_stats call, from an older version of the app, left out.)" }] as never);
  });
  it("does the same for an unfinished call to a tool that's gone", async () => {
    const [m] = await repair([msg([{ type: "tool-old_tool", toolCallId: "c", state: "approval-requested", input: {}, approval: { id: "a" } }])], tools);
    expect(m.parts).toEqual([{ type: "text", text: "(An earlier old_tool call, from an older version of the app, left out.)" }]);
  });
});

describe("fromWeb", () => {
  const result = (toolName: string): ModelMessage => ({ role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName, output: { type: "json", value: {} } }] });
  it("sees a web_search or read_url result anywhere in the history", () => {
    expect(fromWeb([{ role: "user", content: "hi" }, result("get_stats")])).toBe(false);
    expect(fromWeb([{ role: "user", content: "hi" }, result("read_url"), result("get_stats")])).toBe(true);
  });
  it("counts a note written from the web, read back later, as the web", () => {
    const read = (toolName: string, value: object): ModelMessage =>
      ({ role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName, output: { type: "json", value } as never }] });
    const tainted = new Set(["notes/20261001-from-web.md"]);
    expect(fromWeb([read("read_note", { path: "notes/20261001-from-web.md", text: "x" })], tainted)).toBe(true);
    expect(fromWeb([read("search_notes", { results: [{ path: "notes/20261001-from-web.md", snippet: "x" }] })], tainted)).toBe(true);
    expect(fromWeb([read("read_note", { path: "notes/20261001-from-web.md", text: "x" })])).toBe(false);
    expect(fromWeb([read("read_note", { path: "notes/a.md", text: "see notes/20261001-from-web.md" })], tainted)).toBe(false);   // a mention isn't a read
    expect(fromWeb([read("create_note", { saved: "notes/20261001-from-web.md" })], tainted)).toBe(false);
    expect(fromWeb([read("show_items", { shown: [{ path: "notes/20261001-from-web.md", title: "x" }] })], tainted)).toBe(true);   // shown cards carry its text too
    expect(fromWeb([read("show_items", { shown: [{ kind: "task", id: "t1", title: "x" }] })], new Set(["t1"]))).toBe(true);
    expect(fromWeb([read("show_day", { shown: "day", booked: [{ at: "10:00", id: "t1", title: "x" }] })], new Set(["t1"]))).toBe(true);        // so do the widgets'
    expect(fromWeb([read("show_lens", { shown: "lens", notes: { count: 1, sample: [{ path: "notes/20261001-from-web.md", title: "x" }] } })], tainted)).toBe(true);
    expect(fromWeb([read("find_free_slots", { slots: [] })], new Set(["t1"]))).toBe(false);
  });
});

describe("output shaping", () => {
  it("clip: cuts at n and says so", () => {
    expect(clip("abc", 5)).toEqual({ text: "abc" });
    expect(clip("abcdef", 4)).toEqual({ text: "abcd", truncated: true, chars: 6 });
  });
  it("capList: the top, or the newest of a dated list, and how many were left out", () => {
    expect(capList([1, 2, 3], 3)).toEqual({ list: [1, 2, 3] });
    expect(capList([1, 2, 3, 4], 2)).toEqual({ list: [1, 2], left_out: 2 });
    expect(capList([1, 2, 3, 4], 2, true)).toEqual({ list: [3, 4], left_out: 2 });
  });
});
