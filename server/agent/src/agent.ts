// POST /agent/chat: one turn of the agent (turn.ts, the runner Talk shares), streamed back as the AI SDK's UI message
// stream, so a client is useChat + DefaultChatTransport({ api: "/agent/chat" }), sending only its newest message
// (`message`). The history is the server's: read from the chat's record (chats.ts), the message taken as history.ts says
// (the owner's new one, appended, its files stored as chat files first; a retry; or the reply with the answers to what it
// waits on), and saved back by this turn alone, every few seconds and when it ends, stopped and failed ones too. A save
// that fails at the end is an error in the stream, which the client shows: a chat is never lost unseen.
// One turn holds a chat at a time (chats.ts `hold`): a second request while one runs is refused (409), unless the running
// one's client already went (a Stop), which it waits out.
// Note writes ask through the SDK's tool approval: the confirm card comes back as an approval-requested part, the client's
// answer as an approval-responded one on the next request, taken only for a card the saved reply waits on and signed by this
// server, which runs it.
// An assistant client sends `context` (what is on screen, packages/core/src/assistant.ts): it ends the newest message's
// <context>, and the tools the app does itself (open_note …, no `execute`) are offered. Such a call ends the turn until
// the client answers it with addToolOutput and sends the reply again.
// While a turn runs, the owner can steer it (steer.ts): their message joins the turn at the next step boundary.
// A note action's run (note-action.ts) sends `action`: the turn is narrowed to what that action may do.
import { experimental_createSteering as createSteering, createUIMessageStreamResponse, readUIMessageStream, type UIMessageChunk } from "ai";
import { z } from "zod";
import { ChatHistoryError } from "@/core/chat-history";
import { EFFORTS } from "@/core/agent";
import { runOf } from "@/core/note-actions";
import type { Server } from "@/core/pocketbase";
import { hold, load, saver } from "./chats";
import { storeFiles } from "./chat-files";
import { Context } from "./assistant";
import { settle } from "./guard";
import { next, stepOf } from "./history";
import { model } from "./models";
import { withoutPictures } from "./drawings";
import { runTurn, type AgentMessage } from "./turn";

const SAVE_EVERY = 3000;

const Body = z.object({
  id: z.string().min(1).max(64),
  message: z.unknown(),
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

  const steering = createSteering();
  const held = await hold(id, { steering, stopping: () => req.signal.aborted });
  if (!held) return fail(409, "A reply is still being written in this chat: wait for it, or stop it.");
  let handedOver = false;
  try {
    let stored;
    try { stored = await load(server, id); } catch (e) {
      if (e instanceof ChatHistoryError) return fail(400, e.message);
      throw e;
    }
    if (!stored) return fail(404, `No chat ${id}: create it in chats first.`);
    const step = stepOf(stored.messages, parsed.data.message);
    if ("status" in step) return fail(step.status, step.error);
    if (step.kind === "said") {
      try { step.message = await storeFiles(server, id, step.message); } catch (e) { return fail(502, (e as Error).message); }
    }
    // settle: a turn stopped mid-tool, a card passed over
    const history = settle(next(stored.messages, step));

    // A saved chat holds no picture bytes: a draw's picture is for the turn it was drawn in (drawings.ts)
    const keep = saver(server, id, stored.rev, picked), save = (ms: AgentMessage[]) => keep(withoutPictures(ms));
    let last: Promise<void> | undefined;
    const turn = await runTurn({
      server, pick, model: picked, effort, page, history, action,
      abortSignal: req.signal,                     // the client's Stop (or a dropped connection) ends the turn
      steering, smooth: true,
      onEnd: (all) => { last = save(all); last.catch(() => undefined).finally(held.release); },
    });
    if ("error" in turn) return fail(400, turn.error);
    handedOver = true;

    // A copy of the stream builds the reply as the client sees it, saved every few seconds while it runs; a failed one is
    // tried again by the next
    const [out, copy] = turn.stream.tee();
    const reply = history.at(-1), continued = reply?.role === "assistant";
    const before = continued ? history.slice(0, -1) : history;
    void (async () => {
      let at = Date.now();
      try {
        for await (const m of readUIMessageStream<AgentMessage>({ message: continued ? reply : undefined, stream: copy })) {
          if (Date.now() - at < SAVE_EVERY) continue;
          at = Date.now();
          save([...before, m]).catch(() => undefined);
        }
      } catch { /* the final save (onEnd) has it */ }
    })();
    // The final save is in before the stream ends; its failure is the stream's last word
    const told = out.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
      async flush(c) {
        try { await last; } catch (e) { c.enqueue({ type: "error", errorText: (e as Error).message }); }
      },
    }));
    return createUIMessageStreamResponse({ stream: told, keepAliveMs: 15_000 });
  } finally {
    if (!handedOver) held.release();
  }
}
