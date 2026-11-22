// A chat is a record in `chats` (pb_migrations/1792600000_chats.js): the client creates it, empty, before its first
// message; from then on the agent is the one writer of its messages, title and model. It holds the history (a client sends
// only its newest message, history.ts) and saves it as a reply streams and when it ends, however it ends. Every save of a
// chat goes through one queue, in order, each naming the rev the last one left (pb_hooks/rev.pb.js,
// 1795700000_chats_rev.js), and one turn holds a chat at a time (`hold`): a chat's turn, or a whole Talk conversation.
import type { Experimental_Steering as Steering, UIMessage } from "ai";
import { serializeChatHistory } from "@/core/chat-history";
import * as pb from "@/core/client/pocketbase";
import { chatTitle } from "@/core/share";
import type { Server } from "@/core/urls";
import type { AgentMessage } from "./turn";

/** What the history calls a chat: its first user message, as the phone named it. */
export function titleOf(ms: UIMessage[]) {
  const first = ms.find((m) => m.role === "user");
  const text = first?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") ?? "";
  return text.trim() ? chatTitle(text.trim()).slice(0, 200) : "";
}

const queues = new Map<string, Promise<unknown>>();

/** `job` after every read and save of chat `id` queued before it. */
function serial<T>(id: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).then(job);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return run;
}

/** The chat's history and the rev its next save names, read after any save of it still on its way; null when there is no
 *  such record. Throws on one it can't read: never let an older agent replace a future format. */
export const load = async (s: Server, id: string): Promise<{ rev: number; messages: AgentMessage[] } | null> => {
  const c = await serial(id, () => pb.chat(s, id));
  return c && { rev: c.rev, messages: c.messages as AgentMessage[] };
};

/** Saves of chat `id`, read at `rev`: in order with every other save of it, each naming the rev the one before left.
 *  Rejects with why one failed (the chat deleted meanwhile, a write it didn't expect); the caller tells the owner. */
export function saver(s: Server, id: string, rev: number, model: string) {
  return (messages: UIMessage[]) => serial(id, async () => {
    try {
      rev = (await pb.call(s, `collections/chats/records/${encodeURIComponent(id)}?fields=rev`,
        pb.json("PATCH", { ...serializeChatHistory(messages), title: titleOf(messages), model, rev }))).rev;
    } catch (e) {
      throw new Error(`This chat wasn't saved: ${(e as Error).message}`);
    }
  });
}

/** How long a new turn waits for one whose client already went (a Stop, a dropped connection) to let the chat go. */
export const LET_GO_MS = 10_000;

type Held = { steering?: Steering; stopping: () => boolean; gone: Promise<void>; free: () => void };
const held = new Map<string, Held>();

/** A chat held by one turn until `release`. */
export type Hold = { release: () => void };

/** Holds chat `id` for one turn, or a Talk conversation: null while another holds it, unless that one's client already
 *  went (`stopping`) and it lets go within LET_GO_MS, its last save in. `steering`: the turn's, for steer.ts. */
export async function hold(id: string, o: { steering?: Steering; stopping?: () => boolean } = {}): Promise<Hold | null> {
  for (;;) {
    const was = held.get(id);
    if (!was) {
      let free!: () => void;
      const h: Held = { steering: o.steering, stopping: o.stopping ?? (() => false), gone: new Promise<void>((r) => { free = r; }), free: () => free() };
      held.set(id, h);
      return { release: () => { if (held.get(id) === h) { held.delete(id); h.free(); } } };
    }
    if (!was.stopping()) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const left = await Promise.race([was.gone.then(() => true), new Promise<false>((r) => { timer = setTimeout(() => r(false), LET_GO_MS); })]);
    clearTimeout(timer);
    if (!left) return null;
  }
}

/** The steering of the turn holding chat `id`; undefined when none does, or it is a Talk conversation's. */
export const steeringOf = (id: string): Steering | undefined => held.get(id)?.steering;
