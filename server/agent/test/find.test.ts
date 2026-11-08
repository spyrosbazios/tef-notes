// POST /agent/find, the model mocked: it answers with hits, and a path or id it made up never reaches the client.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { foundOf } from "@/core/find";
import { newTask } from "@/core/todo";
import { find } from "../src/find";
import type { model } from "../src/models";
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());

type Reply = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const call = (toolName: string, input: object): Reply => ({
  content: [{ type: "tool-call", toolCallId: `c${Math.random()}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
});

let replies: Reply[] = [], offered: string[][] = [];
const mock = new MockLanguageModelV3({ doGenerate: async (o) => { offered.push((o.tools ?? []).map((t) => t.name)); return replies.shift()!; } });
const pick = (async () => ({ model: mock, providerOptions: {} })) as unknown as typeof model;
const ask = (body: unknown) => find(new Request("http://x/agent/find", { method: "POST", body: JSON.stringify(body) }), { url: pb.url }, pick);

beforeEach(() => {
  pb.notes.clear(); pb.tasks.clear(); replies = []; offered = [];
  pb.put("notes/20261001-boiler.md", "---\ntitle: Boiler service\ncreated: 2026-10-01\n---\nThe technician came in January.\n");
  const t = newTask("t1".padEnd(15, "0"), { title: "Call the plumber", order: 1 });
  pb.tasks.set(t.id, { ...t, rev: 1 });
});

describe("POST /agent/find", () => {
  it("searches, then answers with the hits, made-up ones dropped", async () => {
    replies = [
      call("list_tasks", { view: "all", query: "plumber" }),
      call("answer", {
        notes: [{ path: "notes/20261001-boiler.md", why: "the heating service" }, { path: "notes/nope.md", why: "made up" }],
        tasks: [{ id: "t1".padEnd(15, "0"), why: "about the heating" }, { id: "ghost", why: "made up" }],
      }),
    ];
    const res = await ask({ q: "when was the heating last looked at" });
    expect(res.status).toBe(200);
    expect(foundOf(await res.json())).toEqual({
      notes: [{ path: "notes/20261001-boiler.md", why: "the heating service" }],
      tasks: [{ id: "t1".padEnd(15, "0"), why: "about the heating" }],
    });
    expect(offered[0]?.sort()).toEqual(["answer", "list_tasks", "read_note", "search_notes"]);   // read-only, no writes, no web
    expect(replies).toHaveLength(0);                                                             // the answer ended it
  });

  it("refuses an empty query", async () => {
    expect((await ask({ q: "  " })).status).toBe(400);
  });
});
