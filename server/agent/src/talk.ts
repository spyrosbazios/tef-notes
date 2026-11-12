// Talk: a spoken conversation with the assistant, over one WebSocket at /agent/talk (contract: packages/core/src/talk.ts).
// The agent holds the live session with the speech model (talkLive.ts, Gemini Live), the browser the microphone and the speaker:
// the owner's voice goes up as binary frames, the model's comes down as binary frames, everything else is JSON. No audio is kept.
//
// The model runs the chat's OWN tools (talkTools.ts: the same tool objects, their descriptions and schemas turned into function
// declarations), with the chat's own pre-write checks (`approvals`, agent.ts), confirm cards and web-taint rules: a call is
// validated, asked about when a write needs the owner, run, and answered. The conversation is kept as the chat keeps one:
// the UI messages go down as `part` events and into `chats` (saved like a chat, so it reopens in the text assistant), and the
// tool calls and results as the model messages `readWeb` and the approvals read, so one definition decides what taints.
//
// The model's tool list is fixed when its session is set up, so the tools a tainted chat loses (loop.ts NOT_WHEN_TAINTED) are
// refused in the handler instead. Calls run beside the talk (NON_BLOCKING): the model says a few words, the owner may speak over
// it or tap a card whenever. A call the model withdraws (`cancelled`, the owner interrupted) is closed unconfirmed if it has
// not run; a write that ran is never undone.
//
// Billing, which decides what Talk costs: Gemini bills the whole session context again with every turn (instructions, tool
// declarations, the notes index, all the turns kept), and caches nothing. So the context stays small (compression, talkLive.ts)
// and the instructions are a snapshot of the start of the conversation.
//
// Without a Gemini key (keys.ts) Talk is off: GET answers 404.
import { generateId, type ModelMessage, type UIMessage } from "ai";
import type { FunctionResponse } from "@google/genai";
import { TALK_RATE, talkClientEventOf, type TalkClientEvent, type TalkPart, type TalkServerEvent, type TalkStatus } from "@/core/talk";
import { isUiTool } from "@/core/assistant";
import * as pb from "@/core/pocketbase";
import { approvals, context, SAVE_EVERY } from "./agent";
import { saver } from "./chats";
import { close, settle } from "./guard";
import { key } from "./keys";
import { NOT_WHEN_TAINTED } from "./loop";
import { Notes } from "./notes";
import { instructions, TALK } from "./systemPrompt";
import { connectGemini, costOf, tokensOf, TALK_MODEL, type Connect, type LiveCall, type LiveEvent, type LiveLink, type Usage } from "./talkLive";
import { answerOf, checked, declarations, failed, modelOutput, offered, run, type Answer } from "./talkTools";
import { Todo } from "./todo";
import { readWeb, tools } from "./tools";

type Start = Extract<TalkClientEvent, { type: "start" }>;
type Part = UIMessage["parts"][number];

/** Where a conversation's two sides go: JSON events and voice frames to the app, and hanging up on it. */
export type Out = { json(e: TalkServerEvent): void; voice(pcm: Uint8Array): void; close(): void };

/** A conversation as the socket sees it. */
export type Talk = { audio(pcm: Uint8Array): void; client(e: TalkClientEvent): void; end(): Promise<void> };

/** The microphone kept while no connection is open (a reconnect takes a moment): at most about three seconds of it. */
const MAX_BACKLOG = 3 * TALK_RATE.mic * 2;
/** How long a reply's first words wait for the owner's own transcript, which can arrive after them: so the owner's words come first. */
const INPUT_LAG = 500;
/** Losses of the connection in a row, with nothing said in between, that end the conversation. */
const MAX_STRIKES = 3;
const CANCELLED = Symbol("cancelled");

const REFUSED = (name: string) => `${name} is not available now: this conversation has read text that came from outside (the web, a PDF, a picture, a place search), and it can carry instructions aimed at you. Tell the owner you can't do that now.`;

/** Starts a conversation: the context and tools of the chat, the speech model connected. Throws when it can't (nothing is left running). */
export async function startTalk(start: Start, out: Out, d: { server: pb.Server; connect: Connect; model: string }): Promise<Talk> {
  const prior = await pb.chat(d.server, start.chat);
  if (!prior) throw new Error(`No chat ${start.chat}: create it in chats first.`);
  const notes = new Notes(d.server), todo = new Todo(d.server), ctx = await context(notes, start.context);
  const untrusted = ctx.foreign ? async () => true : readWeb(notes, todo);
  const web = !!(await key("exa")), offer = offered(tools(notes, todo, untrusted), web, start.context);
  const ask = approvals(notes, todo, start.writesWithoutAsking, untrusted) as Record<string, ((i: unknown, o: { messages: ModelMessage[] }) => Promise<"user-approval" | "not-applicable">) | undefined>;
  const instruction = `${instructions(web)}\n${TALK}\n\n${ctx.text}`, decl = declarations(offer);
  const keep = saver(d.server, start.chat, d.model);

  const messages = prior.messages as UIMessage[];                // what the chat held before: kept, so a save never wipes it
  const history: ModelMessage[] = [];                            // the tool calls and results, for the taint checks
  const abort = new AbortController();
  const waits = new Map<string, (v: unknown) => void>(), waitOf = new Map<string, string>(), withdrawn = new Set<string>();
  const queued: FunctionResponse[] = [], backlog: Uint8Array[] = [];
  let backlogBytes = 0, link: LiveLink | undefined, live = 0, seq = 0, opening: Promise<void> | undefined, resume: string | undefined;
  let ended = false, dirty = false, strikes = 0, continuing = false;
  let turn: { user?: UIMessage; assistant?: UIMessage; fresh?: UIMessage } = {};
  let held: TalkServerEvent[] | null = null, heldTimer: ReturnType<typeof setTimeout> | undefined;
  const used = { input: 0, output: 0, cost: 0 };

  // ---- the messages

  const send = (m: UIMessage, index: number) => {
    if (ended) return;
    dirty = true;
    const e: TalkServerEvent = { type: "part", message: m.id, role: m.role as "user" | "assistant", index, part: m.parts[index] as TalkPart };
    if (held && m.role === "assistant") held.push(e); else out.json(e);
  };
  const release = () => {
    clearTimeout(heldTimer);
    const h = held; held = null;
    if (!ended) for (const e of h ?? []) out.json(e);
  };
  const endTurn = () => { release(); turn = {}; };

  /** The assistant's message this words or tool belongs to: the turn's, else (right after a tool answered) the last one, else a
   *  new one; which waits a moment for the owner's words, so they come first. */
  function assistant(): UIMessage {
    if (turn.assistant) return turn.assistant;
    const last = messages.at(-1);
    if (continuing && last?.role === "assistant") return (turn.assistant = last);
    const a: UIMessage = { id: generateId(), role: "assistant", parts: [] };
    messages.push(a);
    turn.assistant = turn.fresh = a;
    if (!turn.user) { held = []; heldTimer = setTimeout(release, INPUT_LAG); }
    return a;
  }
  function heard(text: string) {
    continuing = false;
    let u = turn.user;
    if (!u) {
      u = turn.user = { id: generateId(), role: "user", parts: [{ type: "text", text: "" }] };
      const at = turn.fresh ? messages.indexOf(turn.fresh) : -1;   // the transcript came after the reply began: it still goes first
      if (at >= 0) messages.splice(at, 0, u); else messages.push(u);
    }
    (u.parts[0] as { text: string }).text += text;
    send(u, 0);
    release();
  }
  function said(text: string) {
    const a = assistant(), last = a.parts.at(-1);
    if (last?.type === "text") last.text += text; else a.parts.push({ type: "text", text });
    send(a, a.parts.length - 1);
  }

  // ---- the owner's side of a call: a card's tap, or the app's answer

  const waitFor = (call: string, key: string) => new Promise<unknown>((resolve) => { waits.set(key, resolve); waitOf.set(call, key); });
  const answer = (key: string, v: unknown) => { const r = waits.get(key); waits.delete(key); r?.(v); };

  // ---- the model's calls

  function reply(c: LiveCall, a: Answer) {
    history.push({ role: "tool", content: [{ type: "tool-result", toolCallId: c.id, toolName: c.name, output: a.history }] });
    if (withdrawn.has(c.id) || ended) return;                    // the model dropped this call: nothing is waiting for an answer
    const r = { id: c.id, name: c.name, response: a.response, ...(a.parts && { parts: a.parts }) };
    continuing = true;
    if (link) link.respond([r]); else queued.push(r);
  }

  async function handle(c: LiveCall) {
    const t = offer[c.name];
    const bad = async (message: string) => reply(c, failed(message, true));
    if (!t) return bad(`There is no tool ${c.name}.`);
    const v = await checked(t, c.args);
    if ("error" in v) return bad(`The input does not fit ${c.name}: ${v.error}`);
    history.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: c.id, toolName: c.name, input: v.input }] });
    const a = assistant();
    const at = a.parts.length;
    let part = { type: `tool-${c.name}`, toolCallId: c.id, state: "input-available", input: v.input } as Part;
    const show = (p: Part, ans?: Answer) => { part = p; a.parts[at] = p; send(a, at); if (ans) reply(c, ans); };
    a.parts.push(part); send(a, at);
    try {
      if (NOT_WHEN_TAINTED.has(c.name) && await untrusted(history)) return show({ ...part, state: "output-error", errorText: REFUSED(c.name) } as Part, failed(REFUSED(c.name)));
      let done: unknown;
      if (isUiTool(c.name)) {                                    // the app does it: wait for its answer
        const r = await waitFor(c.id, `output:${c.id}`);
        if (r === CANCELLED) return show(close(part));
        done = r;
      } else {
        if ((await ask[c.name]?.(v.input, { messages: history })) === "user-approval") {
          const id = generateId();
          show({ ...part, state: "approval-requested", approval: { id } } as Part);
          const r = await waitFor(c.id, `approval:${id}`) as { approved: boolean; reason?: string } | typeof CANCELLED;
          if (r === CANCELLED) return show(close(part));
          if (!r.approved) return show({ ...part, state: "output-denied", approval: { id, approved: false, ...(r.reason && { reason: r.reason }) } } as Part, answerOf({ type: "execution-denied", reason: r.reason }));
          show({ ...part, state: "approval-responded", approval: { id, approved: true } } as Part);
        }
        done = await run(t, v.input, { toolCallId: c.id, messages: history, abortSignal: abort.signal });
      }
      show({ ...part, state: "output-available", output: done } as Part, answerOf(await modelOutput(t, c.id, v.input, done)));
    } catch (e) {
      if (ended) return;
      const message = e instanceof Error ? e.message : String(e);
      show({ ...part, state: "output-error", errorText: message } as Part, failed(message));
    }
  }

  function cancel(ids: string[]) {
    for (const id of ids) {
      withdrawn.add(id);
      const k = waitOf.get(id);
      if (k) answer(k, CANCELLED);
    }
  }

  // ---- the connection

  const open = (): Promise<void> => (opening ??= (async () => {
    try {
      const id = ++seq;
      const l = await d.connect({ instruction, tools: decl, resume }, (e) => { if (id === live) onEvent(e); });
      if (ended) return l.close();
      const old = link;
      live = id; link = l;
      old?.close();                                              // its events are dropped from here on: `live` moved
      for (const c of backlog.splice(0)) l.audio(c);
      backlogBytes = 0;
      for (const r of queued.splice(0)) l.respond([r]);
    } finally { opening = undefined; }
  })());

  async function lost(error?: string) {
    link = undefined;
    if (!resume || ++strikes > MAX_STRIKES) return fail(error ?? "The speech model hung up");
    try { await open(); } catch (e) { void fail((e as Error).message); }
  }

  function onEvent(e: LiveEvent) {
    switch (e.type) {
      case "voice": strikes = 0; out.voice(e.pcm); break;
      case "heard": strikes = 0; heard(e.text); break;
      case "said": strikes = 0; said(e.text); break;
      case "interrupted": out.json({ type: "interrupted" }); endTurn(); break;
      case "turnComplete": endTurn(); break;
      case "calls": for (const c of e.calls) void handle(c); break;
      case "cancelled": cancel(e.ids); break;
      case "usage": count(e.usage); break;
      case "goAway": if (resume) open().catch((x: Error) => console.error(`agent: talk: reconnecting failed: ${x.message}`)); break;
      case "handle": resume = e.handle; break;
      case "closed": if (!ended) void lost(e.error); break;
    }
  }

  function count(u: Usage) {
    const t = tokensOf(u);
    used.input += t.input; used.output += t.output; used.cost += costOf(u);
    if (!ended) out.json({ type: "usage", ...used });
  }

  // ---- the ends

  async function fail(message: string) {
    if (ended) return;
    console.error(`agent: talk: ${message}`);
    out.json({ type: "error", message });
    out.close();
    await end();
  }

  const timer = setInterval(() => { if (dirty) { dirty = false; void keep(settle(messages, true)); } }, SAVE_EVERY);
  async function end() {
    if (ended) return;
    ended = true;
    clearInterval(timer); clearTimeout(heldTimer);
    abort.abort();
    for (const k of [...waits.keys()]) answer(k, CANCELLED);
    link?.close(); link = undefined;
    await keep(settle(messages, true));                          // what is still open is closed: the chat reopens cleanly
  }

  try { await open(); } catch (e) { await end(); throw e; }
  out.json({ type: "ready" });
  return {
    audio(pcm) {
      if (link) return link.audio(pcm);
      backlog.push(pcm); backlogBytes += pcm.length;
      while (backlogBytes > MAX_BACKLOG) backlogBytes -= backlog.shift()!.length;
    },
    client(e) {
      if (e.type === "approval") answer(`approval:${e.id}`, { approved: e.approved, reason: e.reason });
      else if (e.type === "output") answer(`output:${e.toolCallId}`, e.output);
    },
    end,
  };
}

// ---- the socket

/** What the socket carries: where the notes are, the speech model, and the conversation once it started. */
type Sock = { server: pb.Server; connect: Connect; model: string; first: boolean; closed: boolean; talk?: Talk };

/** Whether a WebSocket upgrade may come from where it says: no `Origin` (a client that is not a browser) or one on this server's own host
 *  (`Host`, or `X-Forwarded-Host` behind the reverse proxy). A browser lets any website open a WebSocket to any address, and there is
 *  no sign-in here, so this is what keeps another website out (the JSON routes have the preflight). */
export function sameOrigin(h: { get(name: string): string | null }): boolean {
  const origin = h.get("origin");
  if (origin === null) return true;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const own = [h.get("host") ?? "", ...(h.get("x-forwarded-host") ?? "").split(",")].map((x) => x.trim().toLowerCase());
  return own.includes(host);
}

/** `GET /agent/talk`: the status, or with an upgrade the conversation. 404 without a Gemini key; 403 from another website. */
export async function talkRoute(req: Request, srv: Bun.Server<Sock>, server: pb.Server, connect: Connect = connectGemini(TALK_MODEL), model = TALK_MODEL): Promise<Response | undefined> {
  if (!(await key("gemini"))) return new Response("Talk is off", { status: 404 });
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ model } satisfies TalkStatus);
  if (!sameOrigin(req.headers)) return new Response("Talk answers only the app on this server", { status: 403 });
  return srv.upgrade(req, { data: { server, connect, model, first: false, closed: false } }) ? undefined : new Response("Not a WebSocket upgrade", { status: 400 });
}

/** Voice frames not sent while this much is already waiting on the socket (a client that fell behind): late speech is worth nothing. */
const MAX_VOICE_BACKLOG = 1 << 20;

const outOf = (ws: Bun.ServerWebSocket<Sock>): Out => ({
  json: (e) => { ws.send(JSON.stringify(e)); },
  voice: (pcm) => { if (ws.getBufferedAmount() < MAX_VOICE_BACKLOG) ws.send(pcm); },
  close: () => ws.close(1000),
});

async function begin(ws: Bun.ServerWebSocket<Sock>, start: Start) {
  const { server, connect, model } = ws.data;
  try {
    const talk = await startTalk(start, outOf(ws), { server, connect, model });
    ws.data.talk = talk;
    if (ws.data.closed) await talk.end();                        // hung up while it was starting
  } catch (e) {
    console.error(`agent: talk: ${(e as Error).message}`);
    if (!ws.data.closed) { ws.send(JSON.stringify({ type: "error", message: (e as Error).message } satisfies TalkServerEvent)); ws.close(1011); }
  }
}

/** Bun's WebSocket handler for /agent/talk: the first text frame must be `start`; after it binary frames are the microphone. */
export const talkSocket: Bun.WebSocketHandler<Sock> = {
  maxPayloadLength: 1 << 20,
  message(ws, raw) {
    const d = ws.data;
    if (typeof raw !== "string") return d.first ? d.talk?.audio(raw) : ws.close(1008, "The first frame is a start");
    const e = talkClientEventOf(raw);
    if (!d.first) {
      d.first = true;
      if (e?.type !== "start") return ws.close(1008, "The first frame is a start");
      void begin(ws, e);
    } else if (e) d.talk?.client(e);
  },
  close(ws) {
    ws.data.closed = true;
    void ws.data.talk?.end();
  },
};
