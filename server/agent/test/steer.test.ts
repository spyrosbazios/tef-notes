// POST /agent/chat/:id/steer: a message sent while a turn runs joins it at the next step boundary, shows in the reply
// as a steering-message part and is saved there; with no turn running it is not delivered.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { chat } from "../src/agent";
import type { model } from "../src/models";
import { steerRoute } from "../src/steer";
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());

type Reply = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const toolCall = (toolName: string, input: object): Reply => ({
  stream: convertArrayToReadableStream([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ]),
});
const text = (t: string): Reply => ({
  stream: convertArrayToReadableStream([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ]),
});

const steer = (t: string) => steerRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ text: t }) }), "chat1").then((r) => r.json());

let replies: Reply[] = [], prompts: string[] = [], steered: Promise<unknown> | undefined;
const mock = new MockLanguageModelV3({
  doStream: async (o) => {
    // the owner steers while the first step runs
    if (!prompts.length) steered = steer("make it oat milk");
    prompts.push(JSON.stringify(o.prompt));
    return replies.shift()!;
  },
});
const pick = (async () => ({ model: mock, providerOptions: {} })) as unknown as typeof model;

beforeEach(() => {
  pb.notes.clear(); pb.chats.clear(); replies = []; prompts = []; steered = undefined;
  pb.chats.set("chat1", { id: "chat1", title: "", messages: null, model: "" });
  pb.put("notes/20261001-shopping.md", "---\ntitle: Shopping\ncreated: 2026-10-01\n---\n- eggs\n");
});

describe("steering", () => {
  it("joins the running turn at the next step, and is saved where it came in", async () => {
    replies = [toolCall("read_note", { path: "notes/20261001-shopping.md" }), text("Oat milk it is.")];
    const user: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "what's on shopping?" }] };
    const res = await chat(new Request("http://x/agent/chat", {
      method: "POST", body: JSON.stringify({ id: "chat1", messages: [user], model: "m", writesWithoutAsking: false, effort: "normal" }),
    }), { url: pb.url }, pick);
    const chunks = (await res.text()).split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)) as UIMessageChunk);
    let out: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream: convertArrayToReadableStream(chunks) })) out = m;

    expect(await steered).toEqual({ delivered: true });
    expect(prompts[0]).not.toContain("oat milk");
    expect(prompts[1]).toContain("make it oat milk");
    const types = out!.parts.map((p) => p.type);
    expect(types.indexOf("steering-message")).toBeGreaterThan(types.indexOf("tool-read_note"));
    await Bun.sleep(50);
    expect(JSON.stringify(pb.chats.get("chat1")!.messages)).toContain("make it oat milk");
  });

  it("is not delivered when no turn runs", async () => {
    expect(await steer("hello")).toEqual({ delivered: false });
  });
});
