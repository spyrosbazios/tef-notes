// Talk end to end, the speech model faked (a `Connect` that records what the session sends and lets a test play the model's
// side): the chat's tools run for it, a write waits on its card, taint withdraws memory, a cancelled call is closed unrun, what
// was said becomes messages in order, and the saved chat is one the text assistant reads. No test reaches Google.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeValidateUIMessages, type UIMessage } from "ai";
import { Behavior, type FunctionResponse } from "@google/genai";
import { talkServerEventOf, type TalkClientEvent, type TalkServerEvent } from "@/core/talk";
import { parseNote } from "@/core/notes";
import { sameOrigin, startTalk, talkRoute, talkSocket, type Out, type Talk } from "../src/talk";
import { costOf, eventsOf, usageOf, type Connect, type LiveEvent, type Setup } from "../src/talkLive";
import { declarations, LEFT_OUT, offered } from "../src/talkTools";
import { Notes } from "../src/notes";
import { Todo } from "../src/todo";
import { tools } from "../src/tools";
import { fakePb } from "./fake-pb";

const pb = fakePb();
const keys = mkdtempSync(join(tmpdir(), "talk-keys-"));
beforeAll(() => { process.env.TEF_NOTES_KEYS_DIR = keys; });
afterAll(() => { pb.stop(); rmSync(keys, { recursive: true }); delete process.env.TEF_NOTES_KEYS_DIR; });

const PATH = "notes/20261001-shopping.md";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** The model's side: what each connection was set up with and sent, and a way to speak as the model. */
function fakeLive() {
  const links: { setup: Setup; audio: Uint8Array[]; responses: FunctionResponse[]; closed: boolean; on: (e: LiveEvent) => void }[] = [];
  const connect: Connect = async (setup, on) => {
    const l = { setup, audio: [] as Uint8Array[], responses: [] as FunctionResponse[], closed: false, on };
    links.push(l);
    return { audio: (p) => { l.audio.push(p); }, respond: (r) => { l.responses.push(...r); }, close: () => { l.closed = true; } };
  };
  return { connect, links, now: () => links.at(-1)!, say: (e: LiveEvent) => links.at(-1)!.on(e) };
}

function fakeOut() {
  const o = { events: [] as TalkServerEvent[], voice: [] as Uint8Array[], closed: false };
  const out: Out = { json: (e) => { o.events.push(JSON.parse(JSON.stringify(e))); }, voice: (p) => { o.voice.push(p); }, close: () => { o.closed = true; } };
  const parts = (state?: string) => o.events.flatMap((e) => (e.type === "part" && e.part.type !== "text" && (!state || e.part.state === state) ? [e.part as Record<string, any>] : []));
  return { ...o, out, o, parts };
}

let live: ReturnType<typeof fakeLive>, out: ReturnType<typeof fakeOut>, talk: Talk;
const tick = () => Bun.sleep(120);

/** `spoke`: the owner has said something already (a reply's words wait a moment for the owner's transcript, so most tests start from there). */
async function begin(over: { writesWithoutAsking?: boolean; context?: boolean; spoke?: boolean } = {}) {
  live = fakeLive(); out = fakeOut();
  talk = await startTalk(
    { type: "start", chat: "chat1", writesWithoutAsking: over.writesWithoutAsking ?? false, ...(over.context !== false && { context: { view: { kind: "home" as const } } }) },
    out.out, { server: { url: pb.url }, connect: live.connect, model: "gemini-test" });
  if (over.spoke !== false) live.say({ type: "heard", text: "hi" });
}
const call = (id: string, name: string, args: object) => live.say({ type: "calls", calls: [{ id, name, args }] });
const ask = (e: TalkClientEvent) => talk.client(e);
const note = () => pb.notes.get(PATH)!;
const answers = () => live.now().responses;

beforeEach(() => {
  pb.notes.clear(); pb.chats.clear(); pb.attachments.clear();
  pb.chats.set("chat1", { id: "chat1", title: "", messages: null, model: "" });
  pb.put(PATH, "---\ntitle: Shopping\ncreated: 2026-10-01\n---\n- eggs\n");
  pb.put("agent/memory.md", "---\ntitle: Memory\ncreated: 2026-10-01\n---\nOwner likes terse answers.\n");
});

describe("a conversation", () => {
  it("sets the model up with the chat's instructions, the spoken addition, the context and the tools, then says ready", async () => {
    await begin();
    const s = live.now().setup;
    expect(s.instruction).toContain("You help the user capture, organise and find again");
    expect(s.instruction).toContain("This is a spoken conversation");
    expect(s.instruction).toContain(PATH);
    expect(s.instruction).toContain("Showing: Home");
    expect(s.tools.map((t) => t.name)).toContain("open_note");
    expect(out.o.events[0]).toEqual({ type: "ready" });
    await talk.end();
  });

  it("refuses a chat that is not there, leaving nothing running", async () => {
    live = fakeLive(); out = fakeOut();
    await expect(startTalk({ type: "start", chat: "nope", writesWithoutAsking: false }, out.out, { server: { url: pb.url }, connect: live.connect, model: "m" }))
      .rejects.toThrow("No chat nope");
    expect(live.links).toHaveLength(0);
  });

  it("runs a read tool and hands the model its result, with a status", async () => {
    await begin();
    call("c1", "read_note", { path: PATH });
    await tick();
    expect(answers()).toHaveLength(1);
    expect(answers()[0]).toMatchObject({ id: "c1", name: "read_note", response: { status: "ok" } });
    expect(JSON.stringify(answers()[0].response)).toContain("eggs");
    expect(out.parts().map((p) => p.state)).toEqual(["input-available", "output-available"]);
    expect(out.parts()[0]).toMatchObject({ type: "tool-read_note", toolCallId: "c1", input: { path: PATH } });
    await talk.end();
  });

  it("answers a call that does not fit the tool's schema with an error, and shows nothing", async () => {
    await begin();
    call("c1", "append_to_note", { path: PATH });                      // no text
    call("c2", "no_such_tool", {});
    await tick();
    expect(answers().map((a) => (a.response as { status: string }).status)).toEqual(["error", "error"]);
    expect(out.parts()).toHaveLength(0);
    expect(note().rev).toBe(1);
    await talk.end();
  });

  it("shows a write as a card and waits; the owner's approval runs it once", async () => {
    await begin();
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    await tick();
    const card = out.parts("approval-requested")[0];
    expect(card).toMatchObject({ type: "tool-append_to_note", toolCallId: "c1" });
    expect(typeof card.approval.id).toBe("string");
    expect(note().rev).toBe(1);
    expect(answers()).toHaveLength(0);

    ask({ type: "approval", id: card.approval.id, approved: true });
    await tick();
    expect(note().rev).toBe(2);
    expect(out.parts().map((p) => p.state)).toEqual(["input-available", "approval-requested", "approval-responded", "output-available"]);
    expect(out.parts("output-available")[0].approval).toEqual({ id: card.approval.id, approved: true });
    expect(answers()[0].response).toMatchObject({ status: "ok" });

    ask({ type: "approval", id: card.approval.id, approved: true });     // the same tap twice changes nothing
    await tick();
    expect(note().rev).toBe(2);
    await talk.end();
  });

  it("a denied card runs nothing and tells the model, with the owner's reason", async () => {
    await begin();
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    await tick();
    ask({ type: "approval", id: out.parts("approval-requested")[0].approval.id, approved: false, reason: "wrong list" });
    await tick();
    expect(note().rev).toBe(1);
    expect(out.parts("output-denied")[0].approval).toMatchObject({ approved: false, reason: "wrong list" });
    expect(answers()[0]).toMatchObject({ id: "c1", response: { status: "denied", message: "wrong list" } });
    await talk.end();
  });

  it("an answer from a card the model never asked is nothing", async () => {
    await begin();
    ask({ type: "approval", id: "made-up", approved: true });
    ask({ type: "output", toolCallId: "made-up", output: {} });
    await tick();
    expect(answers()).toHaveLength(0);
    await talk.end();
  });

  it("with writes without asking, a write runs with no card", async () => {
    await begin({ writesWithoutAsking: true });
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    await tick();
    expect(note().rev).toBe(2);
    expect(out.parts("approval-requested")).toHaveLength(0);
    expect(out.parts().map((p) => p.state)).toEqual(["input-available", "output-available"]);
    await talk.end();
  });

  it("a delete asks whatever the setting says", async () => {
    await begin({ writesWithoutAsking: true });
    call("c1", "delete_note", { path: PATH });
    await tick();
    expect(out.parts("approval-requested")).toHaveLength(1);
    expect(note()).toBeDefined();
    await talk.end();
  });

  it("after a tool that reads outside text the talk is tainted: a write asks even with writes without asking, and memory is refused", async () => {
    pb.attach(parseNote(PATH, "").id, "photo-1.png", png);
    await begin({ writesWithoutAsking: true });
    call("c1", "read_image", { path: PATH, name: "photo-1.png" });
    await tick();
    expect(answers()[0].parts?.[0].inlineData).toMatchObject({ mimeType: "image/png" });      // the picture goes to the model as the result's part
    expect(out.parts("output-available")[0].output).not.toHaveProperty("bytes");

    call("c2", "append_to_note", { path: PATH, text: "milk" });
    call("c3", "update_memory", { text: "Owner likes everything.", why: "test" });
    await tick();
    expect(out.parts("approval-requested").map((p) => p.toolCallId)).toEqual(["c2"]);
    expect(note().rev).toBe(1);
    expect(answers().find((a) => a.id === "c3")?.response).toMatchObject({ status: "error", error: expect.stringContaining("not available now") });
    expect(out.parts("output-error").map((p) => p.toolCallId)).toEqual(["c3"]);
    expect(pb.notes.get("agent/memory.md")!.rev).toBe(1);
    await talk.end();
  });

  it("memory is written when nothing outside was read", async () => {
    await begin({ writesWithoutAsking: true });
    call("c1", "update_memory", { text: "Owner likes terse answers, in Greek.", why: "test" });
    await tick();
    expect(pb.notes.get("agent/memory.md")!.rev).toBe(2);
    await talk.end();
  });

  it("a tool the app does waits for the app's answer and passes it on", async () => {
    await begin();
    call("c1", "open_note", { path: PATH });
    await tick();
    expect(out.parts("input-available")[0]).toMatchObject({ type: "tool-open_note", toolCallId: "c1" });
    expect(answers()).toHaveLength(0);
    ask({ type: "output", toolCallId: "c1", output: { ok: true } });
    await tick();
    expect(out.parts("output-available")[0].output).toEqual({ ok: true });
    expect(answers()[0]).toMatchObject({ id: "c1", response: { status: "ok", output: { ok: true } } });
    call("c2", "go_view", { view: "tag" });
    await tick();
    ask({ type: "output", toolCallId: "c2", output: { error: "A tag view needs a tag." } });
    await tick();
    expect(answers()[1].response).toMatchObject({ status: "error", error: "A tag view needs a tag." });
    await talk.end();
  });

  it("a call the model withdraws before it ran is closed unconfirmed, and what the owner taps later does nothing", async () => {
    await begin();
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    call("c2", "open_task", { id: "t1" });
    await tick();
    const id = out.parts("approval-requested")[0].approval.id;
    live.say({ type: "cancelled", ids: ["c1", "c2"] });
    await tick();
    expect(out.parts("output-denied")[0]).toMatchObject({ toolCallId: "c1", approval: { id, approved: false, reason: "Not confirmed." } });
    expect(out.parts("output-error")[0]).toMatchObject({ toolCallId: "c2", errorText: "The app didn't do it." });
    ask({ type: "approval", id, approved: true });
    await tick();
    expect(note().rev).toBe(1);
    expect(answers()).toHaveLength(0);              // withdrawn calls get no answer
    await talk.end();
  });

  it("a write that already ran is not undone by a cancellation, and its answer is not sent", async () => {
    await begin({ writesWithoutAsking: true });
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    live.say({ type: "cancelled", ids: ["c1"] });
    await tick();
    expect(note().rev).toBe(2);
    expect(out.parts("output-available")).toHaveLength(1);
    expect(answers()).toHaveLength(0);
    await talk.end();
  });

  it("a tool that throws is an error result, and the talk goes on", async () => {
    await begin();
    call("c1", "read_note", { path: "notes/nothing-here.md" });
    call("c2", "list_tags", {});
    await tick();
    expect(answers().map((a) => (a.response as { status: string }).status).sort()).toEqual(["error", "ok"]);
    expect(out.o.closed).toBe(false);
    await talk.end();
  });
});

describe("what was said", () => {
  it("becomes a user message and an assistant message, in that order, as the words grow", async () => {
    await begin({ spoke: false });
    live.say({ type: "heard", text: "Add milk" });
    live.say({ type: "heard", text: " to shopping" });
    live.say({ type: "said", text: "Done." });
    live.say({ type: "turnComplete" });
    const parts = out.o.events.filter((e) => e.type === "part");
    expect(parts.map((e) => [e.role, e.part.text])).toEqual([["user", "Add milk"], ["user", "Add milk to shopping"], ["assistant", "Done."]]);
    expect(new Set(parts.map((e) => e.message)).size).toBe(2);
    await talk.end();
    const saved = pb.chats.get("chat1")!;
    expect((saved.messages as UIMessage[]).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved).toMatchObject({ title: "Add milk to shopping", model: "gemini-test" });
  });

  it("keeps the owner's words first when their transcript lags the reply", async () => {
    await begin({ spoke: false });
    live.say({ type: "said", text: "Sure." });
    expect(out.o.events.filter((e) => e.type === "part")).toHaveLength(0);       // held a moment for the owner's words
    live.say({ type: "heard", text: "Hello there" });
    expect(out.o.events.filter((e) => e.type === "part").map((e) => e.role)).toEqual(["user", "assistant"]);
    live.say({ type: "turnComplete" });

    live.say({ type: "said", text: "Anything else?" });                           // a transcript later than the wait: the saved order is still right
    await Bun.sleep(600);
    live.say({ type: "heard", text: "No thanks" });
    live.say({ type: "turnComplete" });
    await talk.end();
    expect((pb.chats.get("chat1")!.messages as UIMessage[]).map((m) => `${m.role}:${(m.parts[0] as { text: string }).text}`))
      .toEqual(["user:Hello there", "assistant:Sure.", "user:No thanks", "assistant:Anything else?"]);
  });

  it("puts a tool's card in the assistant's message between its words, and the words after it in the same one", async () => {
    await begin({ spoke: false });
    live.say({ type: "heard", text: "list my tags" });
    live.say({ type: "said", text: "Let me look." });
    call("c1", "list_tags", {});
    await tick();
    live.say({ type: "turnComplete" });
    live.say({ type: "said", text: "You have two." });
    live.say({ type: "turnComplete" });
    await talk.end();
    const ms = pb.chats.get("chat1")!.messages as UIMessage[];
    expect(ms.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(ms[1].parts.map((p) => p.type)).toEqual(["text", "tool-list_tags", "text"]);
  });

  it("forwards the voice and the interruption, and sends the microphone to the model", async () => {
    await begin({ spoke: false });
    live.say({ type: "voice", pcm: new Uint8Array([1, 2]) });
    live.say({ type: "interrupted" });
    talk.audio(new Uint8Array([3, 4]));
    expect(out.o.voice).toHaveLength(1);
    expect(out.o.events).toContainEqual({ type: "interrupted" });
    expect(live.now().audio).toEqual([new Uint8Array([3, 4])]);
    await talk.end();
  });
});

describe("the connection", () => {
  it("moves to a new connection at a GoAway, from the last resumable handle, keeping the microphone going", async () => {
    await begin({ spoke: false });
    live.say({ type: "handle", handle: "h1" });
    live.say({ type: "goAway" });
    await tick();
    expect(live.links).toHaveLength(2);
    expect(live.links[1].setup.resume).toBe("h1");
    expect(live.links[0].closed).toBe(true);
    expect(out.o.events.filter((e) => e.type === "ready")).toHaveLength(1);
    talk.audio(new Uint8Array([5]));
    expect(live.links[1].audio).toEqual([new Uint8Array([5])]);
    live.links[0].on({ type: "said", text: "late words from the old connection" });
    expect(out.o.events.some((e) => e.type === "part")).toBe(false);
    await talk.end();
  });

  it("reconnects when the connection drops with a handle to resume from, and gives up when there is none", async () => {
    await begin({ spoke: false });
    live.say({ type: "handle", handle: "h1" });
    live.say({ type: "closed", error: "reset" });
    await tick();
    expect(live.links).toHaveLength(2);
    expect(out.o.closed).toBe(false);
    await talk.end();

    await begin({ spoke: false });
    live.say({ type: "closed", error: "The speech model hung up" });
    await tick();
    expect(out.o.events.at(-1)).toEqual({ type: "error", message: "The speech model hung up" });
    expect(out.o.closed).toBe(true);
    expect(pb.chats.get("chat1")!.messages).toEqual([]);
  });

  it("keeps the microphone while it reconnects, a little of it", async () => {
    await begin();
    live.say({ type: "handle", handle: "h1" });
    const first = live.links[0];
    first.on({ type: "closed" });
    talk.audio(new Uint8Array(32_000));
    talk.audio(new Uint8Array(32_000));
    talk.audio(new Uint8Array(32_000));
    talk.audio(new Uint8Array(32_000));          // 128 kB against a 96 kB cap: the oldest goes
    await tick();
    expect(live.links[1].audio.reduce((n, c) => n + c.length, 0)).toBeLessThanOrEqual(96_000);
    await talk.end();
  });

  it("closes the model's session and leaves nothing waiting when the owner hangs up; what was open is closed in the saved chat", async () => {
    await begin({ spoke: false });
    live.say({ type: "heard", text: "note milk" });
    call("c1", "append_to_note", { path: PATH, text: "milk" });
    call("c2", "open_note", { path: PATH });
    await tick();
    await talk.end();
    expect(live.now().closed).toBe(true);
    const ms = pb.chats.get("chat1")!.messages as UIMessage[];
    const states = ms.flatMap((m) => m.parts.flatMap((p) => ("state" in p ? [p.state] : [])));
    expect(states.sort()).toEqual(["output-denied", "output-error"]);
    expect(note().rev).toBe(1);
    const events = out.o.events.length;
    live.links[0].on({ type: "said", text: "x" });
    expect(out.o.events).toHaveLength(events);                 // nothing after the end
  });
});

describe("the saved chat", () => {
  it("is valid UI messages for the chat's tools, whatever state the talk ended in", async () => {
    pb.attach(parseNote(PATH, "").id, "photo-1.png", png);
    await begin({ spoke: false });
    live.say({ type: "heard", text: "do things" });
    call("c1", "read_note", { path: PATH });
    call("c2", "append_to_note", { path: PATH, text: "milk" });
    call("c3", "add_task", { title: "Buy milk" });
    call("c4", "open_note", { path: PATH });
    call("c5", "read_image", { path: PATH, name: "photo-1.png" });
    await tick();
    ask({ type: "approval", id: out.parts("approval-requested").find((p) => p.toolCallId === "c3")!.approval.id, approved: false });
    ask({ type: "approval", id: out.parts("approval-requested").find((p) => p.toolCallId === "c2")!.approval.id, approved: true });
    ask({ type: "output", toolCallId: "c4", output: { ok: true } });
    live.say({ type: "said", text: "Done." });
    await tick();
    call("c6", "show_items", { items: [{ kind: "note", ref: PATH }] });
    await tick();
    call("c7", "delete_note", { path: PATH });                  // a card still open when it ends
    await tick();
    await talk.end();
    const messages = pb.chats.get("chat1")!.messages as UIMessage[];
    const notes = new Notes({ url: pb.url }), todo = new Todo({ url: pb.url });
    const r = await safeValidateUIMessages({ messages, tools: tools(notes, todo) as never });
    expect(r.success ? "" : r.error.message).toBe("");
    expect(JSON.stringify(messages)).not.toContain("iVBOR");     // no picture bytes
  });
});

describe("usage", () => {
  it("adds up what each response used and says what it cost at the list price", async () => {
    await begin();
    live.say({ type: "usage", usage: { input: { AUDIO: 1_000_000 }, output: { AUDIO: 1_000_000 } } });
    live.say({ type: "usage", usage: { input: { TEXT: 1_000_000 }, output: { TEXT: 1_000_000 } } });
    const usage = out.o.events.filter((e) => e.type === "usage");
    expect(usage.at(-1)).toEqual({ type: "usage", input: 2_000_000, output: 2_000_000, cost: 3 + 12 + 0.75 + 4.5 });
    await talk.end();
  });

  it("reads the model's metadata: per modality, thoughts as text, no details as the fallback", () => {
    const u = usageOf({
      promptTokenCount: 30, promptTokensDetails: [{ modality: "AUDIO" as never, tokenCount: 10 }, { modality: "TEXT" as never, tokenCount: 20 }],
      responseTokenCount: 5, thoughtsTokenCount: 7, toolUsePromptTokenCount: 3,
    });
    expect(u).toEqual({ input: { AUDIO: 10, TEXT: 23 }, output: { AUDIO: 5, TEXT: 7 } });
    expect(costOf({ input: { AUDIO: 1_000_000, WHATEVER: 1_000_000 }, output: {} })).toBe(3.75);
  });

  it("reads a server message into the events a client wants, in order", () => {
    const events = eventsOf({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AQI=", mimeType: "audio/pcm" } }] }, outputTranscription: { text: "Hi" }, inputTranscription: { text: "Hello" }, turnComplete: true },
      toolCall: { functionCalls: [{ id: "c1", name: "list_tags", args: {} }, { name: "no id" }] },
      toolCallCancellation: { ids: ["c0"] },
      goAway: { timeLeft: "50s" },
      sessionResumptionUpdate: { newHandle: "h", resumable: true },
    } as never);
    expect(events.map((e) => e.type)).toEqual(["voice", "heard", "said", "turnComplete", "calls", "cancelled", "goAway", "handle"]);
    expect(eventsOf({ sessionResumptionUpdate: { newHandle: "", resumable: false } } as never)).toEqual([]);
  });
});

describe("the tools it is given", () => {
  const all = () => tools(new Notes({ url: pb.url }), new Todo({ url: pb.url }));
  const names = (o: object) => Object.keys(o);

  it("is the chat's tools less the ones Talk leaves out, with the app's own only on a screen, and the web's only with a key", () => {
    const page = { view: { kind: "home" as const } };
    const withWeb = names(offered(all(), true, page)), noWeb = names(offered(all(), false, page)), noScreen = names(offered(all(), true, undefined));
    for (const n of LEFT_OUT) expect(withWeb).not.toContain(n);
    expect(withWeb).toEqual(expect.arrayContaining(["read_note", "append_to_note", "web_search", "read_url", "read_image", "open_note", "open_task", "go_view", "ask_choice"]));
    expect(noWeb).not.toContain("web_search");
    expect(noWeb).not.toContain("read_url");
    for (const n of ["open_note", "open_task", "go_view", "ask_choice"]) expect(noScreen).not.toContain(n);
    expect(names(all()).filter((n) => !withWeb.includes(n)).sort()).toEqual([...LEFT_OUT].filter((n) => names(all()).includes(n)).sort());
  });

  it("each has a declaration made from its own schema, and nothing else has one", () => {
    const o = offered(all(), true, { view: { kind: "home" } }), d = declarations(o);
    expect(d.map((x) => x.name).sort()).toEqual(names(o).sort());
    for (const x of d) {
      expect(x.behavior).toBe(Behavior.NON_BLOCKING);
      expect(x.description).toBeTruthy();
      expect(x.parametersJsonSchema).toMatchObject({ type: "object" });
      expect(x.parametersJsonSchema).not.toHaveProperty("$schema");
    }
    expect(d.map((x) => x.name)).not.toContain("draw");
    expect(JSON.stringify(d.find((x) => x.name === "append_to_note")!.parametersJsonSchema)).toContain('"required":["path","text"]');
  });
});

describe("who may open a conversation", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

  it("lets a client with no Origin in, and a page of this server's own host, behind its proxy or not", () => {
    expect(sameOrigin(h({ host: "minipc:8098" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://notes.example.ts.net", host: "notes.example.ts.net" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://notes.example.ts.net", host: "127.0.0.1:8098", "x-forwarded-host": "notes.example.ts.net" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://NOTES.example.ts.net", host: "127.0.0.1:8098", "x-forwarded-host": "other, notes.example.ts.net" }))).toBe(true);
  });

  it("keeps any other website out", () => {
    expect(sameOrigin(h({ origin: "https://evil.example", host: "notes.example.ts.net" }))).toBe(false);
    expect(sameOrigin(h({ origin: "https://evil.example", host: "127.0.0.1:8098", "x-forwarded-host": "notes.example.ts.net" }))).toBe(false);
    expect(sameOrigin(h({ origin: "https://notes.example.ts.net:444", host: "notes.example.ts.net" }))).toBe(false);
    expect(sameOrigin(h({ origin: "null", host: "notes.example.ts.net" }))).toBe(false);
    expect(sameOrigin(h({ origin: "not a url", host: "notes.example.ts.net" }))).toBe(false);
    expect(sameOrigin(h({ origin: "https://notes.example.ts.net" }))).toBe(false);
  });
});

describe("/agent/talk", () => {
  let live2: ReturnType<typeof fakeLive>, base: string, srv: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    live2 = fakeLive();
    srv = Bun.serve({ port: 0, hostname: "127.0.0.1", routes: { "/agent/talk": { GET: (req, s) => talkRoute(req, s as never, { url: pb.url }, live2.connect, "gemini-test") } }, websocket: talkSocket as never, fetch: () => new Response("", { status: 404 }) });
    base = `127.0.0.1:${srv.port}`;
  });
  afterAll(() => { void srv.stop(true); });

  const keyFile = (on: boolean) => { mkdirSync(join(keys, "gemini"), { recursive: true }); if (on) writeFileSync(join(keys, "gemini", "api-key"), "test-key\n"); else rmSync(join(keys, "gemini"), { recursive: true }); };
  const open = (headers: Record<string, string> = {}) => {
    const ws = new WebSocket(`ws://${base}/agent/talk`, { headers } as never);
    ws.binaryType = "arraybuffer";
    const got: unknown[] = [];
    ws.onmessage = (m) => got.push(typeof m.data === "string" ? talkServerEventOf(m.data) : new Uint8Array(m.data as ArrayBuffer));
    const done = new Promise<number>((r) => { ws.onclose = (e) => r(e.code); ws.onerror = () => r(-1); });
    const opened = new Promise<boolean>((r) => { ws.onopen = () => r(true); ws.onerror = () => r(false); });
    return { ws, got, done, opened };
  };

  it("is off without a Gemini key (404) and answers its model with one", async () => {
    keyFile(false);
    expect((await fetch(`http://${base}/agent/talk`)).status).toBe(404);
    keyFile(true);
    const r = await fetch(`http://${base}/agent/talk`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ model: "gemini-test" });
  });

  it("refuses a page from another website, and takes the app's own", async () => {
    keyFile(true);
    expect(await open({ Origin: "https://evil.example" }).opened).toBe(false);
    const ok = open({ Origin: `http://${base}` });
    expect(await ok.opened).toBe(true);
    ok.ws.close();
  });

  it("starts on a start frame, takes the microphone as binary and the model's voice back, and saves at hangup", async () => {
    keyFile(true);
    const c = open();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", chat: "chat1", writesWithoutAsking: false }));
    await Bun.sleep(150);
    expect(c.got[0]).toEqual({ type: "ready" });
    c.ws.send(new Uint8Array([9, 8]));
    await Bun.sleep(50);
    const link = live2.now();
    expect(link.audio).toEqual([new Uint8Array([9, 8])]);
    link.on({ type: "voice", pcm: new Uint8Array([7, 7]) });
    link.on({ type: "heard", text: "hi" });
    await Bun.sleep(50);
    expect(c.got).toContainEqual(new Uint8Array([7, 7]));
    c.ws.close();
    await c.done;
    await Bun.sleep(100);
    expect(link.closed).toBe(true);
    expect((pb.chats.get("chat1")!.messages as UIMessage[]).map((m) => m.role)).toEqual(["user"]);
  });

  it("closes a socket whose first frame is not a start, and tells one whose chat does not exist", async () => {
    keyFile(true);
    const a = open();
    await a.opened;
    a.ws.send(JSON.stringify({ type: "approval", id: "x", approved: true }));
    expect(await a.done).toBe(1008);

    const b = open();
    await b.opened;
    b.ws.send(new Uint8Array([1]));
    expect(await b.done).toBe(1008);

    const c = open();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", chat: "no-such-chat", writesWithoutAsking: false }));
    expect(await c.done).toBe(1011);
    expect(c.got[0]).toMatchObject({ type: "error", message: expect.stringContaining("No chat no-such-chat") });
  });
});
