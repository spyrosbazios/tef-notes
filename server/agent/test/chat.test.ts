// POST /agent/chat end to end, the model mocked: a write comes back as a confirm card and the chat is saved with it;
// the client's approval runs the write on the next request, and the reply that follows is saved too.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { isToolUIPart, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { cardsOf } from "@/core/agent";
import { parseNote } from "@/core/notes";
import { chat } from "../src/agent";
import type { model } from "../src/models";
import { fakePb } from "./fake-pb";
import { makePdf } from "./pdf";

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

let replies: Reply[] = [], prompts: unknown[] = [], offered: string[][] = [];
const mock = new MockLanguageModelV3({ doStream: async (o) => { prompts.push(o.prompt); offered.push((o.tools ?? []).map((t) => t.name)); return replies.shift()!; } });
const pick = (async () => ({ model: mock, providerOptions: {} })) as unknown as typeof model;

/** The reply as useChat would build it from the stream. */
async function send(messages: UIMessage[], writesWithoutAsking = false, context?: unknown) {
  const res = await chat(new Request("http://x/agent/chat", {
    method: "POST", body: JSON.stringify({ id: "chat1", messages, model: "m", writesWithoutAsking, effort: "normal", context }),
  }), { url: pb.url }, pick);
  expect(res.status).toBe(200);
  const chunks = (await res.text()).split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)) as UIMessageChunk);
  const last = messages.at(-1);
  let out: UIMessage | undefined;
  for await (const m of readUIMessageStream({ message: last?.role === "assistant" ? last : undefined, stream: convertArrayToReadableStream(chunks) })) out = m;
  await Bun.sleep(50);                                      // the final save
  return out!;
}

beforeEach(() => {
  pb.notes.clear(); pb.chats.clear(); pb.attachments.clear(); replies = []; prompts = []; offered = [];
  pb.chats.set("chat1", { id: "chat1", title: "", messages: null, model: "" });
  pb.put("notes/20261001-shopping.md", "---\ntitle: Shopping\ncreated: 2026-10-01\n---\n- eggs\n");
});

describe("POST /agent/chat", () => {
  it("asks before a write, saves the card, runs it once approved, saves the answer", async () => {
    const user: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "add milk to shopping" }] };
    replies = [toolCall("append_to_note", { path: "notes/20261001-shopping.md", text: "milk" })];
    const asked = await send([user]);
    const card = asked.parts.find(isToolUIPart)!;
    expect(card).toMatchObject({ type: "tool-append_to_note", state: "approval-requested" });
    expect(pb.notes.get("notes/20261001-shopping.md")!.rev).toBe(1);                     // nothing written yet
    expect(pb.chats.get("chat1")).toMatchObject({ title: "add milk to shopping", model: "m" });
    expect(pb.chats.get("chat1")!.messages).toHaveLength(2);

    // the prompt carried the context on a copy of the user's message; the saved chat doesn't
    expect(JSON.stringify(prompts[0])).toContain("notes/20261001-shopping.md · Shopping");
    expect(JSON.stringify(pb.chats.get("chat1")!.messages)).not.toContain("<context>");

    const approved = { ...asked, parts: asked.parts.map((p) => (isToolUIPart(p) && p.state === "approval-requested"
      ? { ...p, state: "approval-responded", approval: { ...p.approval, approved: true } } : p)) } as UIMessage;
    replies = [text("Added milk.")];
    const done = await send([user, approved]);
    expect(done.parts.find(isToolUIPart)).toMatchObject({ state: "output-available", output: { saved: "notes/20261001-shopping.md", rev: 2 } });
    // the write's result carries the note's card as it now reads: what the clients draw
    expect(cardsOf((done.parts.find(isToolUIPart) as { output: unknown }).output)).toEqual([
      { kind: "note", path: "notes/20261001-shopping.md", title: "Shopping", preview: "- eggs\n- milk" }]);
    expect(done.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")).toBe("Added milk.");
    expect(parseNote("notes/20261001-shopping.md", pb.notes.get("notes/20261001-shopping.md")!.text).body).toBe("- eggs\n- milk\n");
    const saved = pb.chats.get("chat1")!.messages as UIMessage[];
    expect(saved).toHaveLength(2);
    expect(saved[1].id).toBe(asked.id);                                                   // the same reply, continued
  });

  it("writes without a card when asked to, and refuses a chat that doesn't exist", async () => {
    replies = [toolCall("append_to_note", { path: "notes/20261001-shopping.md", text: "bread" }), text("Done.")];
    await send([{ id: "u1", role: "user", parts: [{ type: "text", text: "bread" }] }], true);
    expect(parseNote("notes/20261001-shopping.md", pb.notes.get("notes/20261001-shopping.md")!.text).body).toBe("- eggs\n- bread\n");

    const res = await chat(new Request("http://x/agent/chat", {
      method: "POST", body: JSON.stringify({ id: "nope", messages: [], model: "m", writesWithoutAsking: false, effort: "normal" }),
    }), { url: pb.url }, pick);
    expect(res.status).toBe(404);
  });
});

describe("POST /agent/chat as the always-on assistant", () => {
  const user: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "tidy this note" }] };
  const page = { view: { kind: "today" }, note: { path: "notes/20261001-shopping.md", title: "Shopping", rev: 1 }, selection: "eggs" };
  const sent = () => JSON.stringify(prompts[0]);

  it("puts the screen last in the newest message's context, and keeps it out of the saved chat", async () => {
    replies = [text("ok")];
    await send([user], false, page);
    const p = sent();
    expect(p).toContain("<screen>");
    expect(p).toContain("Showing: Today (task list)");
    expect(p).toContain("Open note: \\\"notes/20261001-shopping.md\\\" \\\"Shopping\\\" (rev 1)");
    expect(p.lastIndexOf("<screen>")).toBeGreaterThan(p.indexOf("<notes>\\n"));
    expect(p.lastIndexOf("</screen>")).toBeGreaterThan(p.lastIndexOf("</notes>"));
    expect(JSON.stringify(pb.chats.get("chat1")!.messages)).not.toContain("<screen>");
  });

  it("offers the app's tools only with a context; a context that can't be read is a plain chat", async () => {
    replies = [text("a"), text("b"), text("c")];
    await send([user]);
    await send([user], false, { view: { kind: "nope" } });
    await send([user], false, page);
    expect(offered[0]).not.toContain("open_note");
    expect(offered[1]).not.toContain("open_note");
    expect(offered[2]).toEqual(expect.arrayContaining(["open_note", "open_task", "go_view"]));
    expect(prompts.map((p) => JSON.stringify(p).includes("Showing:"))).toEqual([false, false, true]);
  });

  it("streams an app tool to the client and waits; the client's output goes back and the turn carries on", async () => {
    replies = [toolCall("open_note", { path: "notes/20261001-shopping.md" })];
    const asked = await send([user], false, page);
    const call = asked.parts.find(isToolUIPart)!;
    expect(call).toMatchObject({ type: "tool-open_note", state: "input-available", input: { path: "notes/20261001-shopping.md" } });
    expect(replies).toHaveLength(0);                                                      // no second step: it waits

    const answered = { ...asked, parts: asked.parts.map((p) => (isToolUIPart(p) ? { ...p, state: "output-available", output: { ok: true } } : p)) } as UIMessage;
    replies = [text("Opened.")];
    const done = await send([user, answered], false, page);
    expect(done.parts.find(isToolUIPart)).toMatchObject({ state: "output-available", output: { ok: true } });
    expect(done.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")).toBe("Opened.");
  });

  it("previews the open note's PDFs in the context and asks before a write, even with the cards off", async () => {
    pb.attach(parseNote("notes/20261001-shopping.md", "").id, "list.pdf", makePdf(["Flour and sugar", "Butter"]));
    replies = [toolCall("append_to_note", { path: "notes/20261001-shopping.md", text: "milk" })];
    const asked = await send([user], true, page);
    expect(sent()).toContain("<pdfs note=");
    expect(sent()).toContain("Flour and sugar");
    expect(asked.parts.find(isToolUIPart)).toMatchObject({ state: "approval-requested" });
    expect(JSON.stringify(pb.chats.get("chat1")!.messages)).not.toContain("Flour");
  });

  it("writes without asking when the cards are off and the open note has no PDF", async () => {
    replies = [toolCall("append_to_note", { path: "notes/20261001-shopping.md", text: "milk" }), text("Added.")];
    const done = await send([user], true, page);
    expect(sent()).not.toContain("<pdfs note=");
    expect(done.parts.find(isToolUIPart)).toMatchObject({ state: "output-available" });
  });

  it("offers the selection tools only for an editable selection, and says so on the screen", async () => {
    replies = [text("a"), text("b")];
    await send([user], false, page);
    await send([user], false, { ...page, editable: true });
    expect(offered[0]).not.toContain("replace_selection");
    expect(offered[1]).toEqual(expect.arrayContaining(["replace_selection", "insert_after_selection", "add_task", "open_note"]));
    expect(JSON.stringify(prompts[0])).not.toContain("Selected text (editable");
    expect(JSON.stringify(prompts[1])).toContain("Selected text (editable");
  });

  it("streams a selection edit to the client like an app tool, with no card even with the cards on", async () => {
    replies = [toolCall("replace_selection", { text: "**eggs**" })];
    const asked = await send([user], false, { ...page, editable: true });
    expect(asked.parts.find(isToolUIPart)).toMatchObject({ type: "tool-replace_selection", state: "input-available", input: { text: "**eggs**" } });
  });

  it("closes an app tool nobody answered when the owner types on, so the next send doesn't throw", async () => {
    replies = [toolCall("go_view", { view: "inbox" })];
    const asked = await send([user], false, page);
    replies = [text("Sure.")];
    const next: UIMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "never mind" }] };
    const done = await send([user, asked, next], false, page);
    expect(done.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")).toBe("Sure.");
    expect(JSON.stringify(prompts.at(-1))).toContain("The app didn't do it.");
  });
});

describe("POST /agent/chat between steps", () => {
  const ask = (id: string, t: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: t }] });
  const big = "lorem ipsum ".repeat(400);

  it("keeps this turn's long tool results whole, and trims them to a stub on the next turn", async () => {
    pb.put("notes/20261002-long.md", `---\ntitle: Long\ncreated: 2026-10-02\n---\n${big}\n`);
    replies = [toolCall("read_note", { path: "notes/20261002-long.md" }), text("Read it.")];
    const first = await send([ask("u1", "read the long note")]);
    expect(JSON.stringify(prompts[1])).toContain(big.trim());                             // the step after the read sees it all

    replies = [text("Sure.")];
    await send([ask("u1", "read the long note"), first, ask("u2", "thanks")]);
    const later = JSON.stringify(prompts.at(-1));
    expect(later).not.toContain(big.trim());
    expect(later).toContain("Trimmed: read_note's result from an earlier turn");
    expect(JSON.stringify(pb.chats.get("chat1")!.messages)).toContain(big.trim());        // the saved chat keeps it
  });

  it("offers update_memory and the selection tools until the turn reads someone else's text", async () => {
    replies = [text("a")];
    await send([ask("u1", "hi")]);
    expect(offered[0]).toContain("update_memory");

    pb.attach(parseNote("notes/20261001-shopping.md", "").id, "list.pdf", makePdf(["Flour"]));
    replies = [text("b"), text("c")];
    await send([ask("u1", "hi")], false, { view: { kind: "today" }, note: { path: "notes/20261001-shopping.md", title: "Shopping", rev: 1 } });
    await send([ask("u1", "hi")], false, { view: { kind: "today" }, note: { path: "notes/20261001-shopping.md", title: "Shopping", rev: 1 }, selection: "Flour", editable: true });
    expect(offered[1]).not.toContain("update_memory");
    expect(offered[1]).toContain("read_note");
    expect(offered[2]).not.toContain("replace_selection");
    expect(offered[2]).toContain("open_note");
  });

  it("withdraws the selection tools when the words are a note's that a chat which read the web wrote", async () => {
    const page = { view: { kind: "today" }, note: { path: "notes/20261002-clip.md", title: "Clip" }, selection: "words", editable: true };
    pb.put("notes/20261002-clip.md", "---\ntitle: Clip\ncreated: 2026-10-02\n---\nwords\n", { tainted: true });
    pb.put("notes/20261003-mine.md", "---\ntitle: Mine\ncreated: 2026-10-03\n---\nwords\n");
    replies = [text("a"), text("b")];
    await send([ask("u1", "shorten")], false, page);
    await send([ask("u1", "shorten")], false, { ...page, note: { path: "notes/20261003-mine.md", title: "Mine" } });
    expect(offered[0]).not.toContain("replace_selection");
    expect(offered[0]).toContain("read_note");
    expect(offered[1]).toContain("replace_selection");
  });
});
