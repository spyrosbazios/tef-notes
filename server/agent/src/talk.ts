// Talk: a spoken conversation with the assistant, over one WebSocket at /agent/talk (contract: packages/core/src/talk.ts).
// The agent holds both halves of the speech at Fish Audio (fish.ts): the ear decides what a turn is — the owner's, an
// acknowledgement over the voice, or a noise in the room — and the voice speaks the reply. The browser sends the microphone
// and plays the voice; no audio is kept.
//
// A turn is the chat's own (talkAgent.ts over turn.ts): the same agent loop, tools, owner's rules (read for every turn),
// confirm cards and taint checks, over the conversation's UI messages, tool parts and all, so a chat that read the web is
// still tainted when it goes on in Talk. A card's tap and the app's answer to one of its own tools come up the socket; what
// the ear heard never answers a card. The messages go down as `part` events and into `chats` (so it reopens in the text
// assistant).
// Every turn is its own: the owner speaking over the reply (or a new turn) aborts it, and a turn that lost the conversation
// says, shows and runs nothing more (talkAgent.ts `live`).
//
// Billing is why this is Fish and not a speech-to-speech model: nothing is re-billed per turn. The ear is a session's
// seconds, the voice the bytes of what is said (core/talk.ts `costOf`), and the model the text's tokens, cached as any
// chat's. The ear is billed while it is open, so a conversation ends after a while with nothing from the owner, and after an
// hour in all (core/talk.ts TALK_LIMITS). What the owner says goes to Fish to be transcribed; what the assistant says, to be
// voiced.
//
// Without a Fish key (keys.ts) Talk is off: GET answers 404.
import { generateId, isTextUIPart } from "ai";
import type { Effort } from "@/core/agent";
import { talkThinking } from "@/core/prefs";
import type * as pb from "@/core/pocketbase";
import { bytesOf, costOf, talkClientEventOf, TALK_LIMITS, TALK_RATE, type TalkClientEvent, type TalkPart, type TalkServerEvent, type TalkStatus, type TalkVoice } from "@/core/talk";
import { history, saver } from "./chats";
import { ownerPrefs } from "./prefs";
import { settle } from "./guard";
import { key } from "./keys";
import { DEFAULT as DEFAULT_MODEL, type model as pickModel } from "./models";
import { NoteService } from "./application/notes";
import { withoutPictures } from "./drawings";
import { sameOrigin } from "./request-guard";
import type { ConnectEar, ConnectVoice, EarEvent, EarSession, Sea, Voice } from "./fish";
import { talkTurn, type Answer, type Asked } from "./talkAgent";
import type { AgentMessage } from "./turn";

type Start = Extract<TalkClientEvent, { type: "start" }>;

const SAVE_EVERY = 3000;
/** The microphone kept while no ear is open (a reconnect takes a moment): at most about three seconds of it. */
const MAX_BACKLOG = 3 * TALK_RATE.mic * 2;
/** Losses of the ear in a row, with nothing heard in between, that end the conversation. */
const MAX_STRIKES = 3;
/** The lead the app's player needs before its first frame sounds (lib/talk-voice.ts `LEAD`), for the speaking clock. */
const PLAY_LEAD = 60;
/** `text` up to the last sentence end worth speaking on its own, and the rest: the voice starts as soon as there is a
 *  sentence, rather than at the end of the reply. A clause counts from a dozen characters, so it is not the first word. */
const BREAKS = /[.!?…;·\n]/;
const MIN_CLAUSE = 12;

export function wordsOf(text: string): { say: string; rest: string } | null {
  let at = -1;
  for (let i = text.length - 1; i >= 0; i--) if (BREAKS.test(text[i])) { at = i; break; }
  return at < MIN_CLAUSE ? null : { say: text.slice(0, at + 1), rest: text.slice(at + 1) };
}

/** What the ear's turn events become. Fish says one utterance twice: `eager_end_of_turn` (probably over, so the reply starts
 *  now, unconfirmed) and then `committed` (final). Committed text equal to the utterance already being answered only confirms
 *  it; anything else is a new turn. `resumed` (the owner went on) and new speech make the utterance forgotten. */
export function turnsOf(act: { start(text: string, confirmed: boolean): void; confirm(): void; cancel(): void }) {
  let last: string | null = null;
  return {
    speech() { last = null; },
    eager(text: string) {
      if (!text.trim() || last === text) return;
      last = text;
      act.start(text, false);
    },
    resumed() { last = null; act.cancel(); },
    turn(text: string) {
      if (last === text) return act.confirm();
      last = text;
      act.start(text, true);
    },
  };
}

/** Whether an ear event is the owner taking the turn over the voice. Only `taken` is: `speech` (Fish's voice activity) opens
 *  on any noise, a cough or the room, so cutting the reply on it made it stop while the owner sat silent; Fish judges whether
 *  it is the owner (and not a noise or a "mm-hm", a backchannel) and says so with `user_turn_taken`. */
export const cutsIn = (e: EarEvent, speaking: boolean): boolean => speaking && e.type === "taken";

/** Where a conversation's two sides go: JSON events and voice frames to the app, and hanging up on it. */
export type Out = { json(e: TalkServerEvent): void; voice(pcm: Uint8Array): void; close(): void };

/** A conversation as the socket sees it. */
export type Talk = { audio(pcm: Uint8Array): void; client(e: TalkClientEvent): void; end(): Promise<void> };

/** What a conversation needs of the world: the notes, how it speaks, and how it thinks. The owner's rules for the agent's
 *  writes are not here: every turn reads them from the preferences (turn.ts). */
export type Deps = {
  server: pb.Server;
  /** The voice model and voice the owner picked (prefs.ts `talk`). */
  sea: Sea;
  /** The chat model for the turns, and the owner's effort (the steps a turn may take). */
  model: string;
  effort: Effort;
  /** The model for an id: models.ts, or a mock in the tests. */
  pick?: typeof pickModel;
  /** Fish, in production; fakes in the tests. */
  connectVoice: ConnectVoice;
  connectEar: ConnectEar;
};

/** A reply under way: its own abort, what it waits on from the app (a card's tap, an app tool's answer), and the answers that
 *  came before it waited (the app does its tool, and the owner may tap, while the round is still streaming). */
type Reply = { abort: AbortController; waits: Map<string, (a: Answer | null) => void>; early: Map<string, Answer> };
/** Answers kept for a reply before it waits on them: a reply asks for a few at most. */
const MAX_EARLY = 16;
const waitKey = (a: Asked) => (a.kind === "approval" ? `approval:${a.id}` : `output:${a.toolCallId}`);

/** Starts a conversation: the chat's history, the ear listening. Throws when it can't, and then nothing of it is open: the
 *  ear is the last thing opened, and the timers start once it is. */
export async function startTalk(start: Start, out: Out, d: Deps): Promise<Talk> {
  const prior = await history(d.server, start.chat);
  if (!prior) throw new Error(`No chat ${start.chat}: create it in chats first.`);
  let messages = settle(prior as AgentMessage[]);
  const keep = saver(d.server, start.chat, d.model);

  let ended = false, dirty = false, strikes = 0, saidBytes = 0;
  let ear: EarSession | undefined, voice: Voice | undefined, opening: Promise<Voice> | undefined, generation = 0;
  let speaking = false, endsAt = 0, backlog: Uint8Array[] = [], backlogBytes = 0;
  let current: Reply | undefined;
  /** When the owner last did something (a turn of theirs, a tap) or the voice last stopped, and when it began: the ear's caps. */
  const began = Date.now();
  let lastActive = began;
  let timer: ReturnType<typeof setInterval> | undefined, beat: ReturnType<typeof setInterval> | undefined;
  /** Whether the ear has confirmed it is the owner's turn: a turn begun on
   *  `eager_end_of_turn` may still be resumed, so its words are held back from the voice until `committed` says so. */
  let confirmed = true, held: string[] = [];

  // ---- the messages

  /** Each message's parts as last sent: a part goes down when it changed. */
  const sent = new Map<string, string[]>();
  const publish = (m: AgentMessage) => {
    if (ended || (m.role !== "user" && m.role !== "assistant")) return;
    const was = sent.get(m.id) ?? [], now = m.parts.map((p) => JSON.stringify(p));
    sent.set(m.id, now);
    now.forEach((json, index) => {
      if (was[index] === json) return;
      dirty = true;
      out.json({ type: "part", message: m.id, role: m.role as "user" | "assistant", index, part: m.parts[index] as TalkPart });
    });
  };
  /** A message as it now reads, in its place (or last, when new), and sent. */
  const show = (m: AgentMessage) => {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i < 0) messages.push(m); else messages[i] = m;
    publish(m);
  };
  /** Whatever the last reply left open is closed: a card never answered is denied, a call never finished an error (guard.ts
   *  `settle`). Nothing of it runs later. */
  const closeOpen = () => { messages = settle(messages, true); messages.forEach(publish); };

  // ---- the voice

  /** Whether the voice is sounding, as the ear needs to know it (a "mm-hm" over it is a backchannel, not a turn). */
  function markSpeaking(on: boolean) {
    if (on === speaking) return;
    speaking = on;
    lastActive = Date.now();
    if (on) endsAt = Date.now() + PLAY_LEAD;
    ear?.speaking(on);
  }

  /** The voice, opened once however many sentences are ready at the same moment. A socket that finishes opening after an
   *  interrupt (the owner spoke over it) is closed, not spoken through. */
  async function voiceNow(): Promise<Voice> {
    const gen = generation;
    opening ??= d.connectVoice({
      audio: (pcm) => {
        if (ended) return;
        out.voice(pcm);
        endsAt = Math.max(endsAt, Date.now()) + (pcm.length / 2 / TALK_RATE.voice) * 1000;
        markSpeaking(true);
      },
      ended: (error) => { voice = undefined; markSpeaking(false); if (error && !ended) void fail(error); },
    }).then((v) => {
      if (gen !== generation || ended) { v.stop(); throw new Error("interrupted"); }
      return (voice = v);
    }).finally(() => { opening = undefined; });
    return opening;
  }

  /** What the app hears: markdown read aloud as the words it is, and Fish told to say it. A reply to a turn the ear has
   *  not confirmed yet waits: the owner may still be speaking, and then it was never an answer. */
  async function say(text: string) {
    const clean = text.replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();
    if (!clean || ended) return;
    if (!confirmed) { held.push(clean); return; }
    const gen = generation;
    try {
      const v = voice ?? await voiceNow();
      if (gen !== generation || ended) return;                 // spoken over while the voice was opening
      v.say(clean);
      v.flush();
      saidBytes += bytesOf(clean);
      // What it has cost is what went to the voice, so it is counted there: a reply held until the ear confirms it lands here
      // in a later tick than the turn's end, and a total sent before it would be a cent short every time
      out.json({ type: "usage", said: saidBytes, cost: costOf(saidBytes, d.sea.model) });
      markSpeaking(true);
    } catch (e) {
      if (ended || (e as Error).message === "interrupted") return;
      await fail((e as Error).message);
    }
  }

  /** The reply's words on their way to the voice: a sentence is said as soon as it is written, not at the end. */
  const speak = (() => {
    let rest = "";
    return {
      feed(delta: string) {
        rest += delta;
        for (let w = wordsOf(rest); w; w = wordsOf(rest)) { rest = w.rest; void say(w.say); }
      },
      /** What is left of the reply is said now: the turn ended, or waits on the owner. */
      flush() { const left = rest.trim(); rest = ""; if (left) void say(left); },
      /** What is left is dropped: the owner spoke over it. */
      drop() { rest = ""; },
    };
  })();

  // ---- a turn: what was heard, then the reply

  async function reply(r: Reply) {
    const live = () => !ended && current === r && !r.abort.signal.aborted;
    try {
      await talkTurn({
        server: d.server, pick: d.pick, model: d.model, effort: d.effort, page: start.context, signal: r.abort.signal, live,
        messages: () => messages,
        show,
        words: (delta) => speak.feed(delta),
        pause: () => { confirm(); speak.flush(); },
        answer: (a) => {
          const k = waitKey(a), had = r.early.get(k);
          if (had) { r.early.delete(k); return Promise.resolve(had); }
          return new Promise((resolve) => { r.waits.set(k, resolve); });
        },
      });
    } catch (e) {
      if (live()) await fail((e as Error).message);
      return;
    }
    if (live()) finishTurn();
  }

  function finishTurn() {
    current = undefined;                           // nothing is thinking now: a later turn has nothing to interrupt but the voice
    const last = messages.at(-1);
    const text = last?.role === "assistant" ? last.parts.filter(isTextUIPart).map((p) => p.text).join(" ") : "";
    if (text.trim()) ear?.said(text);
    confirm();                                     // the reply is complete: whatever was held may be said
    speak.flush();
  }

  /** The ear confirmed the turn is the owner's: what the reply has said so far may be spoken now. */
  function confirm() {
    if (confirmed) return;
    confirmed = true;
    for (const text of held.splice(0)) void say(text);
  }

  function startTurn(text: string) {
    if (ended || !text.trim()) return;
    lastActive = Date.now();
    show({ id: generateId(), role: "user", parts: [{ type: "text", text }] });
    // As the chat settles a resent history: a card left before this message (in the chat it went on from) is denied
    messages = settle(messages);
    messages.forEach(publish);
    const r: Reply = { abort: new AbortController(), waits: new Map(), early: new Map() };
    current = r;
    void reply(r);
  }

  /** The reply under way stops: its model call and tools are aborted, what it waits on is let go, and what it left open is
   *  closed. */
  function stopReply() {
    const r = current;
    if (!r) return;
    current = undefined;
    r.abort.abort();
    for (const w of r.waits.values()) w(null);
    r.waits.clear();
    closeOpen();
  }

  /** The owner spoke over the voice: the reply stops where it is, and what it had not said is dropped. */
  function interrupt() {
    if (!speaking && !current) return;
    stopReply();
    voice?.stop();
    voice = undefined;
    generation++;                                  // a socket still opening, or a sentence on its way, belongs to the reply that ended
    speak.drop(); held = []; confirmed = true;
    markSpeaking(false);
    endsAt = 0;
    if (!ended) out.json({ type: "interrupted" });
  }

  // ---- the ear

  // The turn has probably ended: the model starts thinking now, but nothing is said aloud until `committed` confirms it
  // (a resumed turn was never an answer), and a turn already started on this utterance is not started twice.
  const turns = turnsOf({
    // A new turn ends whatever is still under way: an eager reply the committed text replaced, or one still being spoken
    // when the ear never reported speech over it. Two replies at once was the voice talking over the owner.
    start(text, sure) { interrupt(); confirmed = sure; if (sure) held = []; startTurn(text); },
    confirm,
    cancel() {
      stopReply();
      speak.drop(); confirmed = true; held = [];                      // it was not the owner's turn after all
    },
  });

  const hear = (e: EarEvent) => {
    switch (e.type) {
      case "started": strikes = 0; break;
      case "speech": {
        out.json({ type: "hearing", speaking: e.on });
        if (e.on) turns.speech();                                       // something is being said: whatever was heard is over
        break;
      }
      case "taken": strikes = 0; lastActive = Date.now(); if (cutsIn(e, speaking)) interrupt(); break;   // the owner, not a noise, spoke over the voice
      case "eager": turns.eager(e.text); break;
      case "resumed": turns.resumed(); break;
      case "turn": if (e.yours) { strikes = 0; turns.turn(e.text); } break;
      case "failed": void lostEar(e.message); break;
    }
  };

  async function openEar(): Promise<EarSession> {
    const terms = (await new NoteService(d.server).list()).map((n) => n.title).filter(Boolean).slice(0, 100);
    const s = await d.connectEar(terms);
    if (ended) { s.close(); throw new Error("ended"); }
    s.listen(hear);
    for (const pcm of backlog.splice(0)) s.audio(pcm);
    backlog = []; backlogBytes = 0;
    strikes = 0;
    return s;
  }

  async function lostEar(message: string) {
    ear = undefined;
    if (ended) return;
    if (++strikes > MAX_STRIKES) return fail(message);
    try { ear = await openEar(); } catch (e) { await fail((e as Error).message); }
  }

  // ---- the ends

  async function fail(message: string) {
    if (ended) return;
    console.error(`agent: talk: ${message}`);
    await hangUp(message);
  }

  /** Ends the conversation with a reason the app shows (a failure, or a cap reached). */
  async function hangUp(message: string) {
    if (ended) return;
    out.json({ type: "error", message });
    out.close();
    await end();
  }

  async function end() {
    if (ended) return;
    stopReply();
    ended = true;
    clearInterval(timer); clearInterval(beat);
    ear?.done();
    ear?.close();
    ear = undefined;
    generation++;
    voice?.stop();
    voice = undefined;
    await keep(withoutPictures(settle(messages, true)));
  }

  ear = await openEar();                           // throws with nothing open: the timers start below
  timer = setInterval(() => { if (dirty) { dirty = false; void keep(withoutPictures(settle(messages))); } }, SAVE_EVERY);
  /** The speaking clock (the voice stops counting when the last frame it sent has played), and the ear's caps. */
  beat = setInterval(() => {
    const now = Date.now();
    if (speaking && now > endsAt) markSpeaking(false);
    if (now - began > TALK_LIMITS.maxMs) void hangUp(`Talk ends after ${TALK_LIMITS.maxMs / 60_000} minutes. Start again to go on.`);
    // A reply waiting on a tap is not busy: a card left unanswered doesn't keep the ear open
    else if (!speaking && (!current || current.waits.size > 0) && now - lastActive > TALK_LIMITS.idleMs)
      void hangUp(`Talk ended after ${TALK_LIMITS.idleMs / 60_000} minutes with nothing said. Start again to go on.`);
  }, 150);
  return {
    audio(pcm) {
      if (ear) return ear.audio(pcm);
      backlog.push(pcm); backlogBytes += pcm.length;
      while (backlogBytes > MAX_BACKLOG) backlogBytes -= backlog.shift()!.length;
    },
    /** A tap or the app's answer, for the reply under way. It counts only if that reply waits on it, now or once its round
     *  has streamed (talkAgent.ts `waitingOn`): an id it never issued, or an answer for a reply that already ended, is nothing. */
    client(e) {
      const r = current;
      if (!r || (e.type !== "approval" && e.type !== "output")) return;
      const k = e.type === "approval" ? `approval:${e.id}` : `output:${e.toolCallId}`;
      const a: Answer = e.type === "approval" ? { approved: e.approved, ...(e.reason && { reason: e.reason }) } : { output: e.output };
      lastActive = Date.now();
      const w = r.waits.get(k);
      if (w) { r.waits.delete(k); w(a); } else if (r.early.size < MAX_EARLY) r.early.set(k, a);
    },
    end,
  };
}

// ---- the socket

/** What the socket carries: where the notes are, how it speaks and thinks, and the conversation once it started. */
type Sock = { deps: Deps; first: boolean; closed: boolean; talk?: Talk };

/** `GET /agent/talk`: the status, or with an upgrade the conversation. 404 without a Fish key; 403 from another website. */
export type Fish = { speak: (sea: Sea) => ConnectVoice; hear: ConnectEar; voices: (q: string) => Promise<TalkVoice[]>; fallback: () => Promise<string> };

/** `GET /agent/talk/voices?q=`: the voices Settings offers. */
export async function talkVoicesRoute(req: Request, fish: Fish): Promise<Response> {
  if (!(await key("fish"))) return new Response("Talk is off", { status: 404 });
  try {
    return Response.json(await fish.voices(new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? ""));
  } catch (e) {
    return new Response((e as Error).message, { status: 502 });
  }
}

export async function talkRoute(req: Request, srv: Bun.Server<Sock>, server: pb.Server, fish: Fish): Promise<Response | undefined> {
  if (!(await key("fish"))) return new Response("Talk is off", { status: 404 });
  const { prefs } = await ownerPrefs(server);
  let voice = prefs.talk.voice || process.env.TEF_NOTES_TALK_VOICE || "";
  if (!voice) {
    try { voice = await fish.fallback(); } catch (e) { return new Response((e as Error).message, { status: 502 }); }
  }
  const sea: Sea = { model: prefs.talk.model, voice, speed: prefs.talk.speed };
  const thinking = talkThinking(prefs);
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ model: sea.model, voice: sea.voice, speed: sea.speed } satisfies TalkStatus);
  if (!sameOrigin(req.headers)) return new Response("Talk answers only the app on this server", { status: 403 });
  const deps: Deps = { server, sea, model: thinking.model || DEFAULT_MODEL, effort: thinking.effort, connectVoice: fish.speak(sea), connectEar: fish.hear };
  return srv.upgrade(req, { data: { deps, first: false, closed: false } }) ? undefined : new Response("Not a WebSocket upgrade", { status: 400 });
}

/** Voice frames not sent while this much is already waiting on the socket (a client that fell behind): late speech is worth nothing. */
const MAX_VOICE_BACKLOG = 1 << 20;

const outOf = (ws: Bun.ServerWebSocket<Sock>): Out => ({
  json: (e) => { ws.send(JSON.stringify(e)); },
  voice: (pcm) => { if (ws.getBufferedAmount() < MAX_VOICE_BACKLOG) ws.send(pcm); },
  close: () => ws.close(1000),
});

async function begin(ws: Bun.ServerWebSocket<Sock>, start: Start) {
  try {
    const talk = await startTalk(start, outOf(ws), ws.data.deps);
    ws.data.talk = talk;
    if (ws.data.closed) await talk.end();                        // hung up while it was starting
    else ws.send(JSON.stringify({ type: "ready" } satisfies TalkServerEvent));
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
