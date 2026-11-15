// What Talk's conversation is, as the page draws it: the messages the agent's `part` events build (core/talk.ts: the chat's own
// message parts, so the Ask panel's components draw them), what the conversation is doing right now (`talkStateOf`), and the few
// words the page puts on a clock and a cost. Pure: test/talk.test.ts.
import type { UIMessage } from "ai";
import { isAskTool, type ChoiceOutput } from "@/core/assistant";
import type { TalkServerEvent } from "@/core/talk";
import { isTool, toolName, type Part, type ToolPart } from "@/lib/ask";

export type PartEvent = Extract<TalkServerEvent, { type: "part" }>;

/** What stands in for a part that has not arrived yet: parts are sent by index and may come out of order. */
const GAP: Part = { type: "text", text: "" };

/** `messages` with the part the agent sent: the message is found by its id (new, it goes last, with its role), and part `index` of it
 *  is now `part`. Messages the event leaves alone are the same objects, so a row that didn't change isn't drawn again. The part is the
 *  chat's own, read from the agent as the contract says; its shape is the agent's to keep. */
export function withPart(messages: UIMessage[], e: PartEvent): UIMessage[] {
  const at = messages.findIndex((m) => m.id === e.message);
  const parts = at < 0 ? [] : [...messages[at].parts];
  while (parts.length < e.index) parts.push(GAP);
  parts[e.index] = e.part as unknown as Part;
  if (at < 0) return [...messages, { id: e.message, role: e.role, parts }];
  return messages.map((m, i) => (i === at ? { ...m, parts } : m));
}

/** A call the owner's tap answers: a confirm card asking, or an `ask_choice` with its buttons up. */
export const awaiting = (p: Part): boolean => isTool(p) && (p.state === "approval-requested" || (p.state === "input-available" && isAskTool(toolName(p))));

/** A call that is on its way: asked for, or answered and running. */
const running = (p: Part): boolean => isTool(p) && !awaiting(p) && (p.state === "input-streaming" || p.state === "input-available" || p.state === "approval-responded");

/** The call `id` as the owner has just answered it, before the agent says so: a card's approval (`id` is the approval's), or a
 *  question's choice (`id` is the call's). The agent's next `part` replaces it. */
export function answeredPart(messages: UIMessage[], id: string, answer: { approved: boolean; reason?: string } | { output: ChoiceOutput }): UIMessage[] {
  const mine = (p: Part): p is ToolPart => isTool(p) && awaiting(p) && ("output" in answer ? p.toolCallId === id : "approval" in p && p.approval?.id === id);
  if (!messages.some((m) => m.parts.some(mine))) return messages;
  return messages.map((m) => (!m.parts.some(mine) ? m : {
    ...m,
    parts: m.parts.map((p) => !mine(p) ? p : "output" in answer
      ? { ...p, state: "output-available", output: answer.output }
      : { ...p, state: "approval-responded", approval: { id, approved: answer.approved, ...(answer.reason ? { reason: answer.reason } : {}) } }),
  } as UIMessage));
}

// ---- the transcript

/** One thing in the transcript: words said, by whom, or a run of what was done (tool calls, a thought) as a message of its own, for
 *  the Ask panel's `Turn` to draw (`last`: the newest message's, whose cards can still be answered). */
export type Row =
  | { kind: "said"; key: string; who: "you" | "assistant"; text: string }
  | { kind: "did"; key: string; message: UIMessage; last: boolean };

/** A message's rows, in the order its parts came: a run of text is one thing said, a run of anything else one thing done. Empty text
 *  (a part not arrived yet) and `step-start` marks are nothing. `pending`: the parts the owner's tap answers, held out of the rows. */
function split(m: UIMessage, last: boolean, pending: Part[]): Row[] {
  const rows: Row[] = [];
  let run: Part[] = [], from = 0;
  const flush = () => {
    if (!run.length) return;
    if (run[0].type === "text") {
      const text = run.map((p) => (p.type === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
      if (text) rows.push({ kind: "said", key: `${m.id}:${from}`, who: m.role === "user" ? "you" : "assistant", text });
    } else if (m.role === "assistant") {
      rows.push({ kind: "did", key: `${m.id}:${from}`, message: { id: `${m.id}:${from}`, role: "assistant", parts: run }, last });
    }
    run = [];
  };
  m.parts.forEach((p, i) => {
    if (p.type === "step-start") return;
    if (last && awaiting(p)) { pending.push(p); return; }
    if (run.length && (run[0].type === "text") !== (p.type === "text")) flush();
    if (!run.length) from = i;
    run.push(p);
  });
  flush();
  return rows;
}

const older = new WeakMap<UIMessage, Row[]>();

/** The transcript's rows, and the parts the owner's tap answers (only the newest message's: an older card was passed over). A message
 *  that is no longer the newest keeps its rows as they were, so what didn't change isn't drawn again as the newest one grows. */
export function rowsOf(messages: readonly UIMessage[]): { rows: Row[]; pending: ToolPart[] } {
  const rows: Row[] = [], pending: Part[] = [];
  messages.forEach((m, i) => {
    const last = i === messages.length - 1;
    const mine = last ? split(m, true, pending) : older.get(m) ?? (older.set(m, split(m, false, [])), older.get(m)!);
    rows.push(...mine);
  });
  return { rows, pending: pending.filter(isTool) };
}

/** The conversation's phase, set by the session: not started (or ended), asking the server, live, or failed. */
export type Phase = "idle" | "connecting" | "live" | "failed";

/** What the page shows the conversation doing: while live, the voice playing, then a card or question waiting for the owner's tap,
 *  then a tool running, else it is the owner's turn to speak. Only the newest message counts: a card in an older one was passed over. */
export type TalkState = "idle" | "connecting" | "listening" | "speaking" | "working" | "waiting" | "failed";

export function talkStateOf(phase: Phase, speaking: boolean, messages: readonly UIMessage[]): TalkState {
  if (phase !== "live") return phase;
  if (speaking) return "speaking";
  const last = messages.at(-1), parts = last?.role === "assistant" ? last.parts : [];
  if (parts.some(awaiting)) return "waiting";
  return parts.some(running) ? "working" : "listening";
}

/** The seconds as a clock: 4:07, or 1:02:09 past the hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
}

/** A cost in US dollars as the readout says it: under a dime to the tenth of a cent, from a dime to the cent. */
export const money = (usd: number): string => `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
