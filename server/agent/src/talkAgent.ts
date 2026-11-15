// How Talk's turns are thought up: the chat's own instructions, context and tools, and the chat's model, one step at a
// time. A step is run with nobody to execute its tools (talkTools.ts `unrun`), so talk.ts runs each call itself — with the
// confirm card, the taint rules and the app's own tools — and hands the result back for the next step. Nothing here touches
// the speech: the text is the voice's, and what is said of it is talk.ts's business.
import { streamText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { EFFORT, type Effort } from "@/core/agent";
import type { Actions } from "@/core/actions";
import type { AssistantContext } from "@/core/assistant";
import type { Server } from "@/core/pocketbase";
import { approvals, context } from "./agent";
import { key } from "./keys";
import { model as pickModel } from "./models";
import { PLACES, SYSTEM, TALK, WEB } from "./systemPrompt";
import { policyFor, tools } from "./tools";
import { allowed } from "./tool-policy";
import { offered, unrun } from "./talkTools";
import { Notes } from "./notes";
import { Todo } from "./todo";
import { readWeb } from "./tools";

/** What a write's policy answers (tool-policy.ts): a card, nothing, or a refusal with the owner's reason. */
export type Status = "not-applicable" | "user-approval" | { type: "denied"; reason: string };

/** A tool the step asked for. */
export type Spoken = { id: string; name: string; input: unknown };

/** One step: the reply as it is written, and the calls it asked for (none: it answered). */
export type Turn = { text: AsyncIterable<string>; calls: PromiseLike<Spoken[]> };

export type TalkAgent = {
  /** The instructions the conversation began with: a snapshot, as a conversation's context is (a spoken conversation has no
   *  room to re-read them, and a stable prefix is what the prompt cache is paid on). */
  instruction: string;
  /** The tools the model may ask for, with nobody to run them (the SDK never runs a call itself). */
  tools: ToolSet;
  /** The same tools, to run: talk.ts runs each call, past the card and the taint rules. */
  exec: ToolSet;
  /** Steps a turn may take before it must answer. */
  steps: number;
  /** One step of `history`. */
  turn(history: ModelMessage[], signal: AbortSignal): Turn;
  /** Whether this conversation has read someone else's text: its writes ask, and some tools are withdrawn. */
  foreign: boolean;
  /** Whether it has by now, as the history stands. */
  untrusted(history: ModelMessage[]): Promise<boolean>;
  /** The chat's own pre-write check (agent.ts `approvals`): "user-approval" when the write needs the owner's tap, or a
   *  `denied` status when the owner never allows it. */
  ask(name: string, input: unknown, history: ModelMessage[]): Promise<Status>;
  /** Whether a tool is withdrawn once the conversation has read someone else's text (tool-policy.ts). */
  refuses(name: string): boolean;
};

export type Plan = {
  server: Server;
  /** The chat model (models.ts): the owner's pick, else the server's. */
  model: string;
  effort: Effort;
  /** The owner's rules for the agent's writes (core/actions.ts): what asks, what just goes, what is never allowed. */
  rules: Actions;
  page: AssistantContext | undefined;
  /** Whether this conversation has read someone else's text: its writes ask, always. */
  foreign: boolean;
};

/** The conversation's agent, ready before the socket is answered: the context is a snapshot of the start (talk.ts). */
export async function talkAgent(p: Plan): Promise<TalkAgent> {
  const notes = new Notes(p.server), todo = new Todo(p.server), ctx = await context(notes, p.page);
  const untrusted = p.foreign || ctx.foreign ? async () => true : readWeb(notes, todo);
  const web = !!(await key("exa"));
  // A tool whose action the owner rules out is never offered: the model cannot call what it cannot see
  const all = Object.fromEntries(Object.entries(offered(tools(notes, todo, untrusted), web, p.page)).filter(([n]) => allowed(policyFor(n), p.rules)));
  const { model: m, providerOptions } = await pickModel(p.model);
  const { steps, reasoning } = EFFORT[p.effort];
  const check = approvals(notes, todo, p.rules, untrusted) as Record<string, ((i: unknown, o: { messages: ModelMessage[] }) => Promise<Status>) | undefined>;
  // Talk's own rules ride after the chat's, so nothing the chat says about drawing, lists or markdown has to be unlearned
  const instruction = `${SYSTEM}\n${PLACES}${web ? `\n${WEB}` : ""}\n${TALK}\n\n${ctx.text}`;
  return {
    instruction,
    tools: unrun(all),
    exec: all,
    steps,
    foreign: p.foreign || ctx.foreign,
    untrusted,
    ask: (name, input, history) => check[name]?.(input, { messages: history }) ?? Promise.resolve("not-applicable"),
    refuses: (name) => !!policyFor(name)?.unavailableWhenTainted,
    turn: (history, signal) => {
      const r = streamText({
        model: m,
        system: instruction,
        messages: history,
        tools: unrun(all),
        stopWhen: stepCountIs(1),      // one step at a time: talk.ts runs the calls, then asks again
        reasoning,
        providerOptions,
        abortSignal: signal,
        // A socket has no error boundary to hand a failure to: talk.ts hears it from the stream
        onError: () => {},
      });
      return {
        text: r.textStream,
        calls: r.toolCalls.then((cs) => cs.flatMap((c) => (c.toolName && c.toolCallId ? [{ id: c.toolCallId, name: c.toolName, input: c.input }] : []))),
      };
    },
  };
}

