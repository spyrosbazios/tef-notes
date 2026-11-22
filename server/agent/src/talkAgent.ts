// One turn of Talk, the agent's side: the chat's own turn (turn.ts runTurn, `spoken`), so the instructions, tools, the
// owner's rules, the confirm cards, the taint checks and the model's timeout are the chat's, read for every turn. What
// Talk adds is where the turn's answers come from: the chat's client sends the reply with a card's answer or the app's
// output in it (history.ts takes them through `waitingOn` and `answered`, as here), and here the turn waits for them over
// the socket (talk.ts) and runs the next round itself. Nothing here
// touches the speech: the reply's words go to `words`, and what is said of them is talk.ts's business.
import { getToolName, isToolUIPart, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { isUiTool } from "@/core/assistant";
import type { Effort } from "@/core/agent";
import type { AssistantContext } from "@/core/assistant";
import type { Server } from "@/core/urls";
import type { model as pickModel } from "./models";
import { runTurn, type AgentMessage } from "./turn";

/** Rounds of one spoken turn: each after the app answered what the last one asked (a card, an app's tool). A model that
 *  keeps asking the app for things ends the turn here, as the chat's client would stop resending. */
export const MAX_ROUNDS = 8;

/** What the reply is waiting on: the owner's tap on a card (`approval`), or the app doing one of its own tools (`output`). */
export type Asked = { kind: "approval"; id: string } | { kind: "output"; toolCallId: string };
/** Its answer, as the app sent it: a tap, the tool's output, or why the app couldn't do it (a chat's client after a Stop). */
export type Answer = { approved: boolean; reason?: string } | { output: unknown } | { error: string };

export type TalkTurn = {
  server: Server;
  pick?: typeof pickModel;
  model: string;
  effort: Effort;
  page: AssistantContext | undefined;
  signal: AbortSignal;
  /** Whether this turn is still the conversation's: false once the owner spoke over it or the conversation ended. Checked
   *  after every wait, so a turn that lost it changes nothing, says nothing and runs nothing more. */
  live: () => boolean;
  /** The conversation as it stands. */
  messages: () => AgentMessage[];
  /** A message as it now reads: the owner's, or the reply as it grows. */
  show: (m: AgentMessage) => void;
  /** The reply's words, as they are written. */
  words: (delta: string) => void;
  /** The reply stopped to wait for the app: what it has written so far is to be said now. */
  pause: () => void;
  /** The app's answer to `asked`; null when the turn ended before it came. */
  answer: (asked: Asked) => Promise<Answer | null>;
};

/** What a reply waits on once its round ended: its cards, and the app's own tools it called. */
export function waitingOn(m: AgentMessage): Asked[] {
  return m.parts.flatMap((p): Asked[] => {
    if (!isToolUIPart(p)) return [];
    if (p.state === "approval-requested") return [{ kind: "approval", id: p.approval.id }];
    return p.state === "input-available" && isUiTool(getToolName(p)) ? [{ kind: "output", toolCallId: p.toolCallId }] : [];
  });
}

/** The reply with the app's answers in it, as the chat's client puts them there (addToolApprovalResponse, addToolOutput): a
 *  card's answer keeps the server's signature (approval-secret.ts), so the next round runs the write only if it issued it. */
export function answered<M extends UIMessage>(m: M, asked: readonly Asked[], answers: readonly Answer[]): M {
  return {
    ...m,
    parts: m.parts.map((p) => {
      if (!isToolUIPart(p)) return p;
      const i = asked.findIndex((a) => (a.kind === "approval" ? p.state === "approval-requested" && p.approval.id === a.id : p.state === "input-available" && p.toolCallId === a.toolCallId));
      const a = answers[i];
      if (i < 0 || !a) return p;
      if ("output" in a) return { ...p, state: "output-available", output: a.output };
      if ("error" in a) return { ...p, state: "output-error", errorText: a.error };
      return p.state !== "approval-requested" ? p : { ...p, state: "approval-responded", approval: { ...p.approval, approved: a.approved, ...(a.reason && { reason: a.reason }) } };
    }),
  } as M;
}

/** Runs one spoken turn to its end: round after round while the reply waits on the app. Throws what the model's stream
 *  failed with (a timeout among them); a turn that lost the conversation just stops. */
export async function talkTurn(t: TalkTurn): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const run = await runTurn({ server: t.server, pick: t.pick, model: t.model, effort: t.effort, page: t.page, history: t.messages(), spoken: true, abortSignal: t.signal });
    if (!t.live()) return;
    if ("error" in run) throw new Error(run.error);
    const last = t.messages().at(-1), continued = last?.role === "assistant";
    let failed: string | undefined;
    // The words go to the voice as the model writes them, ahead of the message they build
    const words = new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(c, out) {
        if (c.type === "text-delta" && t.live()) t.words(c.delta);
        // An abort nobody asked for is the model's timeout (turn.ts MODEL_TIMEOUT)
        if (c.type === "abort" && !t.signal.aborted) failed = "The model stopped answering.";
        out.enqueue(c);
      },
    });
    for await (const m of readUIMessageStream<AgentMessage>({ message: continued ? last : undefined, stream: run.stream.pipeThrough(words), onError: (e) => { failed = e instanceof Error ? e.message : String(e); } })) {
      if (!t.live()) return;
      t.show(m);
    }
    if (!t.live()) return;
    if (failed) throw new Error(failed);
    const reply = t.messages().at(-1);
    const asked = reply?.role === "assistant" ? waitingOn(reply) : [];
    if (!reply || !asked.length) return;
    t.pause();
    const answers = await Promise.all(asked.map(t.answer));
    if (!t.live()) return;
    if (answers.some((a) => a === null)) return;
    t.show(answered(reply, asked, answers as Answer[]));
  }
}
