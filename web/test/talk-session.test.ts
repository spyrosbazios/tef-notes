// A whole Talk conversation over fakes: the socket, microphone, voice, wake lock and the app's tools stand in for the browser's, and the
// test plays the agent. What it pins down is the contract (core/talk.ts): the first frame is `start`, no microphone before `ready`,
// the voice played and dropped on `interrupted`, UI tools done and answered once, an approval sent only by a tap, and everything
// closed again on every way out.
import { describe, expect, test } from "bun:test";
import { talkClientEventOf, TALK_RATE, type TalkClientEvent, type TalkServerEvent } from "@/core/talk";
import type { AssistantContext } from "@/core/assistant";
import { pcm16 } from "@/lib/pcm";
import { createSession, MIC_FRAME, type Deps } from "@/lib/talk-session";

const tick = () => new Promise((r) => setTimeout(r, 0));

function rig(over: Partial<Deps> = {}) {
  const r = {
    sent: [] as (string | ArrayBuffer)[], pushed: 0, flushed: 0, closed: { link: 0, mic: 0, voice: 0, awake: 0 }, muted: [] as boolean[], tools: [] as unknown[],
    on: null as null | Parameters<Deps["open"]>[0], onFrame: null as null | ((s: Float32Array) => void), playing: null as null | ((p: boolean) => void), chats: 0,
    // What the agent does
    hear: (e: TalkServerEvent | ArrayBuffer) => r.on?.message(e instanceof ArrayBuffer ? e : JSON.stringify(e)),
    // What the app said, as events
    events: () => r.sent.filter((s): s is string => typeof s === "string").map((s) => talkClientEventOf(s)!) as TalkClientEvent[],
    audio: () => r.sent.filter((s): s is ArrayBuffer => typeof s !== "string"),
  };
  const context: AssistantContext = { view: { kind: "talk" } };
  const deps: Deps = {
    open: (on) => { r.on = on; return { send: (d) => r.sent.push(d), close: () => { r.closed.link++; } }; },
    mic: async (onFrame) => { r.onFrame = onFrame; return { mute: (on) => r.muted.push(on), close: () => { r.closed.mic++; } }; },
    voice: (on) => { r.playing = on; return { push: () => { r.pushed++; on(true); }, flush: () => { r.flushed++; }, level: () => 0.5, close: () => { r.closed.voice++; } }; },
    chat: async () => { r.chats++; return "chat1"; },
    context: () => context,
    writesWithoutAsking: () => true,
    tool: async (name, input) => { r.tools.push([name, input]); return { ok: true }; },
    awake: () => () => { r.closed.awake++; },
    now: (() => { let t = 1000; return () => (t += 500); })(),
    ...over,
  };
  return { r, session: createSession(deps) };
}

/** Started, the socket open, and the agent ready. */
async function live(over: Partial<Deps> = {}) {
  const x = rig(over);
  x.session.start();
  await tick();
  x.r.on!.open();
  x.r.hear({ type: "ready" });
  return x;
}

const frame = (n = MIC_FRAME) => new Float32Array(n).fill(0.25);
const ask = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ type: "tool-add_task", toolCallId: "c1", state, input: { title: "milk" }, ...extra, ...(id ? { approval: { id } } : {}) });

describe("starting", () => {
  test("the chat first, then the socket; `start` is the first frame, with the page's context and the setting", async () => {
    const { r, session } = rig();
    session.start();
    expect(session.snapshot()).toMatchObject({ phase: "connecting", state: "connecting" });
    expect(r.on).toBeNull();                       // the socket waits for the microphone and the chat
    await tick();
    expect(r.chats).toBe(1);
    r.on!.open();
    expect(r.events()).toEqual([{ type: "start", chat: "chat1", context: { view: { kind: "talk" } }, writesWithoutAsking: true }]);
    expect(session.snapshot().chat).toBe("chat1");
  });
  test("both audio paths open inside the tap, before anything is awaited", () => {
    let mic = 0, voice = 0;
    const { session } = rig({ mic: async () => { mic++; return { mute() {}, close() {} }; }, voice: () => { voice++; return { push() {}, flush() {}, level: () => 0, close() {} }; } });
    session.start();
    expect([mic, voice]).toEqual([1, 1]);
  });
  test("the microphone goes up only from `ready`, as 16-bit PCM", async () => {
    const { r, session } = rig();
    session.start();
    await tick();
    r.on!.open();
    r.onFrame!(frame());
    expect(r.audio()).toHaveLength(0);
    r.hear({ type: "ready" });
    expect(session.snapshot()).toMatchObject({ phase: "live", state: "listening", startedAt: expect.any(Number) });
    r.onFrame!(frame());
    expect(r.audio()).toHaveLength(1);
    expect(new Uint8Array(r.audio()[0])).toEqual(new Uint8Array(pcm16(frame())));
    expect(MIC_FRAME / TALK_RATE.mic).toBeGreaterThanOrEqual(0.02);
    expect(MIC_FRAME / TALK_RATE.mic).toBeLessThanOrEqual(0.1);
  });
  test("a second start while one runs does nothing", async () => {
    const { r, session } = await live();
    session.start();
    await tick();
    expect(r.chats).toBe(1);
  });
});

describe("muting", () => {
  test("stops the microphone going up and its level, without dropping the session", async () => {
    const { r, session } = await live();
    r.onFrame!(frame());
    expect(session.levels().mic).toBeGreaterThan(0);
    session.mute(true);
    r.onFrame!(frame());
    expect(r.audio()).toHaveLength(1);
    expect(session.levels().mic).toBe(0);
    expect(session.snapshot()).toMatchObject({ muted: true, phase: "live" });
    session.mute(false);
    r.onFrame!(frame());
    expect(r.audio()).toHaveLength(2);
    expect(r.muted).toEqual([true, false]);
  });
});

describe("the voice", () => {
  test("frames are played in order and show the conversation speaking; `interrupted` drops them at once", async () => {
    const { r, session } = await live();
    r.hear(new ArrayBuffer(960));
    r.hear(new ArrayBuffer(960));
    expect(r.pushed).toBe(2);
    expect(session.snapshot().state).toBe("speaking");
    expect(session.levels().voice).toBe(0.5);
    r.hear({ type: "interrupted" });
    expect(r.flushed).toBe(1);
    expect(session.snapshot().state).toBe("listening");
  });
  test("audio before `ready` is not played", async () => {
    const { r, session } = rig();
    session.start();
    await tick();
    r.on!.open();
    r.hear(new ArrayBuffer(960));
    expect(r.pushed).toBe(0);
  });
});

describe("what was said and done", () => {
  test("parts build the messages, usage is kept", async () => {
    const { r, session } = await live();
    r.hear({ type: "part", message: "u1", role: "user", index: 0, part: { type: "text", text: "add milk" } });
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "text", text: "Adding" } });
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "text", text: "Adding it" } });
    r.hear({ type: "usage", input: 120, output: 30, cost: 0.002 });
    const s = session.snapshot();
    expect(s.messages.map((m) => [m.id, m.parts[0]])).toEqual([["u1", { type: "text", text: "add milk" }], ["a1", { type: "text", text: "Adding it" }]]);
    expect(s.usage).toEqual({ input: 120, output: 30, cost: 0.002 });
  });
  test("a tool running is working; a card waiting is waiting, and only a tap answers it", async () => {
    const { r, session } = await live();
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-search_notes", toolCallId: "s1", state: "input-available", input: {} } });
    expect(session.snapshot().state).toBe("working");
    r.hear({ type: "part", message: "a1", role: "assistant", index: 1, part: ask("ap1", "approval-requested") });
    expect(session.snapshot().state).toBe("waiting");
    expect(r.events().filter((e) => e.type === "approval")).toEqual([]);   // nothing said or heard approves
    session.approve("ap1", true);
    session.approve("ap1", false);                                          // a second tap on the same card is not sent
    expect(r.events().filter((e) => e.type === "approval")).toEqual([{ type: "approval", id: "ap1", approved: true }]);
    expect(session.snapshot().state).toBe("working");                        // answered, now running
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-search_notes", toolCallId: "s1", state: "output-available", input: {}, output: {} } });
    r.hear({ type: "part", message: "a1", role: "assistant", index: 1, part: ask("ap1", "output-available", { output: {} }) });
    expect(session.snapshot().state).toBe("listening");
  });
  test("a declined card carries its reason", async () => {
    const { r, session } = await live();
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: ask("ap2", "approval-requested") });
    session.approve("ap2", false, "Declined");
    expect(r.events().at(-1)).toEqual({ type: "approval", id: "ap2", approved: false, reason: "Declined" });
  });
  test("buttons answer with an output", async () => {
    const { r, session } = await live();
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-ask_choice", toolCallId: "q1", state: "input-available", input: { question: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } } });
    expect(session.snapshot().state).toBe("waiting");
    expect(r.events().some((e) => e.type === "output")).toBe(false);          // the owner's to answer, never the app's
    session.choose("q1", { chosen: ["b"] });
    expect(r.events().at(-1)).toEqual({ type: "output", toolCallId: "q1", output: { chosen: ["b"] } });
  });
  test("a question that can never be drawn is answered with an error, once", async () => {
    const { r } = await live();
    const bad = { type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-ask_choice", toolCallId: "q2", state: "input-available", input: { question: "?" } } } as const;
    r.hear(bad);
    r.hear(bad);
    const out = r.events().filter((e) => e.type === "output");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ toolCallId: "q2", output: { error: expect.any(String) } });
  });
});

describe("the app's own tools", () => {
  test("done once and answered with an output, however often the part is sent", async () => {
    const { r } = await live();
    const open = { type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-open_note", toolCallId: "t1", state: "input-available", input: { path: "notes/x.md" } } } as const;
    r.hear(open);
    r.hear(open);
    await tick();
    expect(r.tools).toEqual([["open_note", { path: "notes/x.md" }]]);
    expect(r.events().filter((e) => e.type === "output")).toEqual([{ type: "output", toolCallId: "t1", output: { ok: true } }]);
  });
  test("a tool that throws is answered with the error, not left open", async () => {
    const { r } = await live({ tool: async () => { throw new Error("no such note"); } });
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-open_note", toolCallId: "t1", state: "input-available", input: { path: "notes/x.md" } } });
    await tick();
    expect(r.events().at(-1)).toEqual({ type: "output", toolCallId: "t1", output: { error: "no such note" } });
  });
  test("a server tool is none of the app's business", async () => {
    const { r } = await live();
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-search_notes", toolCallId: "s1", state: "input-available", input: {} } });
    await tick();
    expect(r.tools).toEqual([]);
  });
  test("an answer that comes after the conversation ended is not sent", async () => {
    let finish: (v: unknown) => void = () => {};
    const { r, session } = await live({ tool: () => new Promise((res) => { finish = res; }) });
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "tool-go_view", toolCallId: "t1", state: "input-available", input: { view: "home" } } });
    session.end();
    finish({ ok: true });
    await tick();
    expect(r.events().some((e) => e.type === "output")).toBe(false);
  });
});

describe("ending", () => {
  const allClosed = (r: ReturnType<typeof rig>["r"]) => expect(r.closed).toEqual({ link: 1, mic: 1, voice: 1, awake: 1 });
  test("End closes everything and leaves the conversation to read", async () => {
    const { r, session } = await live();
    r.hear({ type: "part", message: "a1", role: "assistant", index: 0, part: { type: "text", text: "Hi" } });
    session.end();
    allClosed(r);
    expect(session.snapshot()).toMatchObject({ phase: "idle", endedAt: expect.any(Number) });
    expect(session.snapshot().messages).toHaveLength(1);
    r.on!.close();                                                           // the socket's own close after it is nothing
    expect(session.snapshot().phase).toBe("idle");
  });
  test("an error ends it, with its message and a retry", async () => {
    const { r, session } = await live();
    r.hear({ type: "error", message: "Quota used up" });
    allClosed(r);
    expect(session.snapshot()).toMatchObject({ phase: "failed", state: "failed", failure: { message: "Quota used up", mic: false } });
    r.on!.close();
    expect(session.snapshot().failure?.message).toBe("Quota used up");
    session.start();                                                         // the retry: a fresh conversation
    expect(session.snapshot()).toMatchObject({ phase: "connecting", failure: null, messages: [] });
  });
  test("the socket closing while live fails it", async () => {
    const { r, session } = await live();
    r.on!.close();
    expect(session.snapshot()).toMatchObject({ phase: "failed", failure: { message: "The connection was lost." } });
    expect(r.closed).toMatchObject({ mic: 1, voice: 1, awake: 1 });
  });
  test("the socket closing before `ready` fails it too", async () => {
    const { r, session } = rig();
    session.start();
    await tick();
    r.on!.close();
    expect(session.snapshot()).toMatchObject({ phase: "failed", failure: { message: "Couldn't reach the server." } });
    expect(r.closed).toMatchObject({ mic: 1, voice: 1 });
  });
  test("End while connecting closes a microphone that opens afterwards", async () => {
    let open: (m: { mute: () => void; close: () => void }) => void = () => {};
    let closed = 0;
    const { session } = rig({ mic: () => new Promise((res) => { open = res; }) });
    session.start();
    session.end();
    open({ mute() {}, close() { closed++; } });
    await tick();
    expect(closed).toBe(1);
    expect(session.snapshot().phase).toBe("idle");
  });
});

describe("failing to start", () => {
  test("a refused microphone says so, opens no chat, and leaves the voice closed", async () => {
    const { r, session } = rig({ mic: async () => { throw new DOMException("no", "NotAllowedError"); } });
    session.start();
    await tick();
    expect(session.snapshot()).toMatchObject({ phase: "failed", failure: { mic: true, message: expect.stringContaining("Microphone access was refused") } });
    expect(r.chats).toBe(0);
    expect(r.closed.voice).toBe(1);
  });
  test("a chat that can't be made fails it and closes the microphone", async () => {
    const { r, session } = rig({ chat: async () => { throw new Error("The server can't be reached."); } });
    session.start();
    await tick();
    expect(session.snapshot()).toMatchObject({ phase: "failed", failure: { message: "The server can't be reached.", mic: false } });
    expect(r.closed).toMatchObject({ mic: 1, voice: 1 });
    expect(r.on).toBeNull();
  });
});
