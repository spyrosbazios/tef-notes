// POST /agent/chat: one turn of the agent (turn.ts, the runner Talk shares), streamed back as the AI SDK's UI message
// stream, so a client is useChat + DefaultChatTransport({ api: "/agent/chat" }). Note writes ask through the SDK's tool
// approval: the confirm card comes back as an approval-requested part, the client's answer as an approval-responded one on
// the next request, which runs it. The chat is saved to `chats` every few seconds and when the turn ends, stopped and
// failed ones too.
// An assistant client sends `context` (what is on screen, packages/core/src/assistant.ts): it ends the newest message's
// <context>, and the tools the app does itself (open_note …, no `execute`) are offered. Such a call ends the turn
// until the client answers it with addToolOutput and resends.
// While a turn runs, the owner can steer it (steer.ts): their message joins the turn at the next step boundary.
// A note action's run (note-action.ts) sends `action`: the turn is narrowed to what that action may do.
import { ChatHistoryError, readChatHistory } from "@/core/chat-history";
import { createUIMessageStreamResponse, readUIMessageStream } from "ai";
import { z } from "zod";
import { EFFORTS } from "@/core/agent";
import { runOf } from "@/core/note-actions";
import type { Server } from "@/core/pocketbase";
import { exists, saver } from "./chats";
import { Context } from "./assistant";
import { settle } from "./guard";
import { steeringFor } from "./steer";
import { model } from "./models";
import { withoutPictures } from "./drawings";
import { runTurn, type AgentMessage } from "./turn";

const SAVE_EVERY = 3000;

const Body = z.object({
  id: z.string().min(1).max(64),
  messages: z.array(z.unknown()),
  model: z.string().min(1).max(200),
  effort: z.enum(EFFORTS),
  context: Context,                     // the page the assistant is on; absent or unreadable: a plain chat
  action: z.unknown().transform(runOf).optional(),  // a note action's run (note-action.ts); absent or unreadable: a plain chat
});

const fail = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** `pick`: the model for the request's id; the tests hand in a mock. */
export async function chat(req: Request, server: Server, pick: typeof model = model): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, `Bad request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const { id, model: picked, effort, context: page, action } = parsed.data;
  let history: AgentMessage[];
  try {
    if (!(await exists(server, id))) return fail(404, `No chat ${id}: create it in chats first.`);
    // settle: a turn stopped mid-tool, a card passed over
    history = settle(readChatHistory({ messages: parsed.data.messages }) as AgentMessage[]);
  } catch (e) {
    if (e instanceof ChatHistoryError) return fail(400, e.message);
    throw e;
  }

  // A saved chat holds no picture bytes: a draw's picture is for the turn it was drawn in (drawings.ts)
  const keep = saver(server, id, picked), save = (ms: AgentMessage[]) => keep(withoutPictures(ms));
  const { steering, done } = steeringFor(id);
  let turn: Awaited<ReturnType<typeof runTurn>>;
  try {
    turn = await runTurn({
      server, pick, model: picked, effort, page, history, action,
      abortSignal: req.signal,                     // the client's Stop (or a dropped connection) ends the turn
      steering, smooth: true, onEnd: save,
    });
  } catch (e) {
    done();
    throw e;
  }
  if ("error" in turn) { done(); return fail(400, turn.error); }

  // A copy of the stream builds the reply as the client sees it, saved every few seconds while it runs
  const [out, copy] = turn.stream.tee();
  const last = history.at(-1), continued = last?.role === "assistant";
  const before = continued ? history.slice(0, -1) : history;
  void (async () => {
    let at = Date.now();
    try {
      for await (const m of readUIMessageStream<AgentMessage>({ message: continued ? last : undefined, stream: copy })) {
        if (Date.now() - at < SAVE_EVERY) continue;
        at = Date.now();
        save([...before, m]);
      }
    } catch { /* the final save (onEnd) has it */ } finally { done(); }
  })();
  return createUIMessageStreamResponse({ stream: out, keepAliveMs: 15_000 });
}
