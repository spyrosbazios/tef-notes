// What a request to /agent/chat may add to a chat (agent.ts). The server holds the history (chats.ts); the client sends
// only its newest message, which is one of:
//  - the owner's new message: text and the files attached with it, nothing else, appended;
//  - the owner's newest message again (the client's Retry, after a reply that failed): the turn runs again from it, the reply
//    after it dropped as the client dropped it. What that reply read leaves the model's view with it, and what it wrote
//    stays marked (a tainted chat's writes are, turn.ts reads the marks every turn);
//  - the reply they answered (a card's tap, the app's answer to one of its own tools): an answer is taken only where the saved
//    reply waits on one, by the ids this server issued (talkAgent.ts `waitingOn` and `answered`, as Talk takes its taps).
// Everything else a client says about the reply or about an earlier message is ignored: no request can edit what the agent
// wrote, read or ran, answer a card it never showed, or drop the record of a page it read (the chat's taint).
import { z } from "zod";
import { ATTACH_MAX } from "@/core/assistant";
import { answered, waitingOn, type Answer, type Asked } from "./talkAgent";
import type { AgentMessage } from "./turn";

/** The longest message the owner can send, and the longest reason for a "no" or an app tool's error. */
const TEXT_MAX = 200_000, REASON_MAX = 2000;

const Said = z.object({
  id: z.string().min(1).max(100),
  role: z.literal("user"),
  parts: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string().max(TEXT_MAX) }),
    z.object({ type: z.literal("file"), mediaType: z.string().min(1).max(100), filename: z.string().max(255).optional(), url: z.string().regex(/^data:/, "a file comes as a data URL") }),
  ])).min(1),
});

const Reply = z.object({ id: z.string().min(1), role: z.literal("assistant"), parts: z.array(z.unknown()) });

/** What the client's message does to the saved history (`stored`), or why it can't. */
export type Step =
  | { kind: "said"; message: AgentMessage }
  | { kind: "retry" }
  | { kind: "answered"; message: AgentMessage }
  | { status: number; error: string };

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/** The client's answer to `a`, from its copy of the reply; undefined when it has none. */
function answerTo(a: Asked, parts: unknown[]): Answer | undefined {
  for (const raw of parts) {
    const p = obj(raw), approval = obj(p?.approval);
    if (a.kind === "approval") {
      if (p?.state !== "approval-responded" || approval?.id !== a.id || typeof approval.approved !== "boolean") continue;
      const reason = typeof approval.reason === "string" && approval.reason.trim() ? approval.reason.slice(0, REASON_MAX) : undefined;
      return { approved: approval.approved, ...(reason && { reason }) };
    }
    if (p?.toolCallId !== a.toolCallId) continue;
    if (p.state === "output-available") return { output: p.output };
    if (p.state === "output-error") return { error: String(p.errorText ?? "The app didn't do it.").slice(0, REASON_MAX) };
  }
  return undefined;
}

/** The client's `message` against the saved history. */
export function stepOf(stored: readonly AgentMessage[], message: unknown): Step {
  const role = obj(message)?.role;
  if (role === "user") {
    const said = Said.safeParse(message);
    if (!said.success) return { status: 400, error: `Bad message: ${said.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
    const m = said.data;
    if (m.parts.filter((p) => p.type === "file").length > ATTACH_MAX) return { status: 400, error: `At most ${ATTACH_MAX} files on one message.` };
    const at = stored.findIndex((x) => x.id === m.id);
    if (at < 0) return { kind: "said", message: m as AgentMessage };
    // The same message again: a retry of the newest one; any other is already answered
    const newest = stored.findLastIndex((x) => x.role === "user");
    return at === newest ? { kind: "retry" } : { status: 409, error: "That message is already in this chat." };
  }
  if (role === "assistant") {
    const reply = Reply.safeParse(message), last = stored.at(-1);
    if (!reply.success) return { status: 400, error: "Bad message: a reply with its parts." };
    if (last?.role !== "assistant" || last.id !== reply.data.id) return { status: 409, error: "This chat has moved on since that reply: open it again." };
    const asked = waitingOn(last);
    if (!asked.length) return { status: 409, error: "Nothing in that reply waits for an answer." };
    const answers = asked.map((a) => answerTo(a, reply.data.parts));
    if (answers.some((a) => !a)) return { status: 409, error: "Answer every card and request in that reply first." };
    return { kind: "answered", message: answered(last, asked, answers as Answer[]) };
  }
  return { status: 400, error: "Bad message: the owner's, or the reply they answered." };
}

/** The history the turn runs on, before guard.ts `settle`. */
export function next(stored: readonly AgentMessage[], step: Exclude<Step, { status: number }>): AgentMessage[] {
  if (step.kind === "said") return [...stored, step.message];
  if (step.kind === "answered") return [...stored.slice(0, -1), step.message];
  return stored.slice(0, stored.findLastIndex((m) => m.role === "user") + 1);
}
