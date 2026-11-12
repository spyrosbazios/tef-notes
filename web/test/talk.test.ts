// Talk's pure pieces: the messages the agent's parts build, what the conversation is doing, the transcript's rows, the audio's
// numbers and the orb's easing. The session over a fake socket is test/talk-session.test.ts.
import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { choiceOutput } from "@/core/assistant";
import { approach, follow, LOOKS } from "@/lib/orb";
import { floats, pcm16, rms } from "@/lib/pcm";
import { answeredPart, clock, money, rowsOf, talkStateOf, withPart, type PartEvent } from "@/lib/talk";

const part = (message: string, index: number, p: PartEvent["part"], role: PartEvent["role"] = "assistant"): PartEvent => ({ type: "part", message, role, index, part: p });
const text = (t: string): PartEvent["part"] => ({ type: "text", text: t });
const tool = (name: string, state: string, extra: Record<string, unknown> = {}): PartEvent["part"] => ({ type: `tool-${name}`, toolCallId: `c-${name}`, state, input: {}, ...extra });
const said = (messages: UIMessage[]) => messages.map((m) => m.parts.map((p) => (p.type === "text" ? p.text : p.type)));

describe("withPart", () => {
  test("a new message goes last, with its role", () => {
    const a = withPart([], part("m1", 0, text("Hi"), "user"));
    const b = withPart(a, part("m2", 0, text("Hello")));
    expect(b.map((m) => [m.id, m.role])).toEqual([["m1", "user"], ["m2", "assistant"]]);
  });
  test("a part grows in place, and messages it leaves alone are the same objects", () => {
    const a = withPart(withPart([], part("m1", 0, text("Hi"), "user")), part("m2", 0, text("Hel")));
    const b = withPart(a, part("m2", 0, text("Hello there")));
    expect(said(b)).toEqual([["Hi"], ["Hello there"]]);
    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
  });
  test("a tool moves through its states at its own index", () => {
    let m = withPart([], part("m1", 0, text("One moment")));
    m = withPart(m, part("m1", 1, tool("add_task", "input-streaming")));
    m = withPart(m, part("m1", 1, tool("add_task", "approval-requested", { approval: { id: "a1" } })));
    m = withPart(m, part("m1", 1, tool("add_task", "output-available", { output: {} })));
    expect(m[0].parts).toHaveLength(2);
    expect(m[0].parts[1]).toMatchObject({ type: "tool-add_task", state: "output-available" });
  });
  test("a part ahead of the ones before it leaves empty text in the gap, which a late one replaces", () => {
    const a = withPart([], part("m1", 2, tool("go_view", "input-available")));
    expect(a[0].parts).toHaveLength(3);
    expect(a[0].parts.every((p) => p !== undefined)).toBe(true);
    expect(a[0].parts[0]).toEqual({ type: "text", text: "" });
    const b = withPart(withPart(a, part("m1", 0, text("Going"))), part("m1", 1, text(" there")));
    expect(b[0].parts.map((p) => p.type)).toEqual(["text", "text", "tool-go_view"]);
    expect(b[0].parts[0]).toEqual({ type: "text", text: "Going" });
  });
});

describe("talkStateOf", () => {
  const asks = withPart([], part("m1", 0, tool("add_task", "approval-requested", { approval: { id: "a1" } })));
  test("not live is the phase", () => {
    for (const phase of ["idle", "connecting", "failed"] as const) expect(talkStateOf(phase, true, asks)).toBe(phase);
  });
  test("live: the voice first, then a card waiting, then a tool running, else listening", () => {
    expect(talkStateOf("live", true, asks)).toBe("speaking");
    expect(talkStateOf("live", false, asks)).toBe("waiting");
    expect(talkStateOf("live", false, withPart([], part("m1", 0, tool("search_notes", "input-available"))))).toBe("working");
    expect(talkStateOf("live", false, withPart([], part("m1", 0, tool("add_task", "approval-responded", { approval: { id: "a", approved: true } }))))).toBe("working");
    expect(talkStateOf("live", false, withPart([], part("m1", 0, tool("search_notes", "output-available"))))).toBe("listening");
    expect(talkStateOf("live", false, [])).toBe("listening");
  });
  test("an ask_choice with its buttons up is waiting, a UI tool still running is working", () => {
    expect(talkStateOf("live", false, withPart([], part("m1", 0, tool("ask_choice", "input-available"))))).toBe("waiting");
    expect(talkStateOf("live", false, withPart([], part("m1", 0, tool("open_note", "input-available"))))).toBe("working");
  });
  test("only the newest message counts, and only the assistant's", () => {
    const older = withPart(asks, part("m2", 0, text("ok"), "user"));
    expect(talkStateOf("live", false, older)).toBe("listening");
  });
});

describe("answeredPart", () => {
  test("a tap shows at once: the card as answered, a question as chosen", () => {
    const ms = withPart(withPart([], part("m1", 0, tool("add_task", "approval-requested", { approval: { id: "a1" } }))), part("m1", 1, tool("ask_choice", "input-available")));
    const approved = answeredPart(ms, "a1", { approved: true });
    expect(approved[0].parts[0]).toMatchObject({ state: "approval-responded", approval: { id: "a1", approved: true } });
    expect(approved[0].parts[1]).toMatchObject({ state: "input-available" });
    const chosen = answeredPart(ms, "c-ask_choice", { output: choiceOutput(["x"]) });
    expect(chosen[0].parts[1]).toMatchObject({ state: "output-available", output: { chosen: ["x"] } });
    expect(answeredPart(ms, "nope", { approved: false })).toBe(ms);
  });
});

describe("rowsOf", () => {
  test("text runs are things said, the rest things done, in order, by whom", () => {
    let m: UIMessage[] = [];
    m = withPart(m, part("u1", 0, text("add milk"), "user"));
    m = withPart(m, part("a1", 0, text("Adding")));
    m = withPart(m, part("a1", 1, text(" it.")));
    m = withPart(m, part("a1", 2, tool("add_task", "output-available")));
    m = withPart(m, part("a1", 3, text("Done.")));
    const { rows, pending } = rowsOf(m);
    expect(rows.map((r) => (r.kind === "said" ? `${r.who}: ${r.text}` : r.kind))).toEqual(["you: add milk", "assistant: Adding it.", "did", "assistant: Done."]);
    expect(pending).toEqual([]);
  });
  test("what waits for a tap is held out of the rows, for the newest message only", () => {
    let m = withPart([], part("a1", 0, tool("add_task", "approval-requested", { approval: { id: "a1" } })));
    expect(rowsOf(m)).toMatchObject({ rows: [], pending: [{ state: "approval-requested" }] });
    m = withPart(m, part("u1", 0, text("never mind"), "user"));
    const { rows, pending } = rowsOf(m);
    expect(pending).toEqual([]);
    expect(rows.map((r) => r.kind)).toEqual(["did", "said"]);   // passed over: it stays a row, the Ask panel says it was not confirmed
  });
  test("empty text and step marks are nothing; rows of an older message are the same objects", () => {
    let m = withPart([], part("a1", 0, { type: "step-start" }));
    m = withPart(m, part("a1", 1, text("")));
    expect(rowsOf(m).rows).toEqual([]);
    m = withPart(m, part("a1", 1, text("Hi")));
    m = withPart(m, part("u1", 0, text("hey"), "user"));
    const first = rowsOf(m).rows, again = rowsOf(withPart(m, part("u1", 0, text("hey you"), "user"))).rows;
    expect(again[0]).toBe(first[0]);
  });
});

test("the clock and the cost", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(67.9)).toBe("1:07");
  expect(clock(3729)).toBe("1:02:09");
  expect(money(0.0123)).toBe("$0.012");
  expect(money(0.5)).toBe("$0.50");
});

describe("audio", () => {
  test("pcm16 is little-endian, clipped, and floats reads it back", () => {
    const pcm = pcm16(new Float32Array([0, 0.5, -0.5, 2, -2]));
    expect([...new Int16Array(pcm)]).toEqual([0, 16383, -16384, 32767, -32768]);
    expect(new Uint8Array(pcm.slice(2, 4))).toEqual(new Uint8Array([0xff, 0x3f]));
    expect([...floats(pcm)].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
  });
  test("an odd trailing byte is not a sample", () => {
    expect(floats(new ArrayBuffer(5))).toHaveLength(2);
    expect(floats(new ArrayBuffer(0))).toHaveLength(0);
  });
  test("rms", () => {
    expect(rms([])).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array([2, 2]))).toBe(1);
  });
});

describe("the orb", () => {
  test("a look eases toward the next and never past it", () => {
    let l = LOOKS.listening;
    for (let i = 0; i < 6; i++) { const next = approach(l, LOOKS.speaking, 1 / 60); expect(next.radius).toBeGreaterThan(l.radius); expect(next.radius).toBeLessThanOrEqual(LOOKS.speaking.radius); l = next; }
    expect(approach(l, LOOKS.speaking, 10).radius).toBeCloseTo(LOOKS.speaking.radius, 3);
    expect(approach(LOOKS.idle, LOOKS.working, 0)).toEqual(LOOKS.idle);
  });
  test("a level rises faster than it falls", () => {
    const up = follow(0, 1, 1 / 60), down = 1 - follow(1, 0, 1 / 60);
    expect(up).toBeGreaterThan(down * 2);
  });
  test("each state has a look of its own", () => {
    const states = Object.keys(LOOKS) as (keyof typeof LOOKS)[];
    expect(new Set(states.map((s) => JSON.stringify(LOOKS[s]))).size).toBe(states.length);
    expect(LOOKS.waiting.pulse).toBe(1);
    expect(LOOKS.working.spin).toBe(1);
    expect(LOOKS.failed.fail).toBe(1);
  });
});
