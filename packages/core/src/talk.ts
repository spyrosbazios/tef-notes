// Talk, the spoken conversation with the assistant: the contract between the agent (server/agent/src/talk.ts) and the
// web's Talk page. The agent holds both halves of the speech, both at Fish Audio — the ear (asr.ts: its realtime socket
// decides when the owner has finished, when they only acknowledged the voice, and when the sound was not them at all)
// and the voice (voice.ts: its streaming text-to-speech) — and runs the chat's own tools, checks and confirm cards for
// each turn. The app sends the microphone and plays the voice; it hears nothing of the speech itself.
//   GET /agent/talk/voices?q= -> TalkVoice[]: the owner's own Fish voices, then public ones (matching `q` when given)
//   GET /agent/talk  -> TalkStatus; 404 while the server has no Fish Audio key (Talk is off: the app hides it)
//   WS  /agent/talk  -> one conversation, for as long as the socket is open. Refused unless the upgrade's Origin is the
//                       server's own: no preflight guards a WebSocket the way it guards the JSON routes.
// Text frames are JSON: a TalkClientEvent up, a TalkServerEvent down. Binary frames are audio, raw 16-bit little-endian
// mono PCM: the microphone up at TALK_RATE.mic (in pieces of 20 to 40 ms, the ear's own pace: a smaller message is read
// sooner), the voice down at TALK_RATE.voice. The app's first frame is `start`, and nothing is read before it; the
// microphone is sent from `ready` on. What was said and done comes down as the chat's own message parts (`part`), so the
// app draws a turn with the chat's components, and the agent saves the conversation to `chats` like any other. Closing
// the socket ends it.
//
// The owner's words are the ear's business: they arrive once, in `part` as the chat holds them, when the ear has settled
// the turn. `hearing` is only whether they are talking right now (the page draws it, and the voice stops when they
// start). What the voice is saying is the agent's own text, streamed to the ear as `context_add` so a follow-up is heard
// in context. Pure types and defensive readers, no I/O.
import { contextOf, type AssistantContext } from "./assistant";

/** Samples per second of each direction's audio: Fish's realtime ear takes 16 kHz as it is, and its voice writes 24 kHz
 *  PCM (the rate the app's player is opened at, `talk-voice.ts`). */
export const TALK_RATE = { mic: 16_000, voice: 24_000 } as const;

/** Samples of microphone in each frame the app sends: 40 ms, the ear's own upper pace. */
export const MIC_FRAME = (TALK_RATE.mic * 40) / 1000;

/** The speech-to-text voice models Talk can speak through. `s2.1-pro-free` is the same engine as `s2.1-pro` at no charge,
 *  under Fish's fair-use limits and without its latency guarantee; the paid one is billed. */
export const TALK_MODELS = ["s2.1-pro-free", "s2.1-pro"] as const;
export type TalkModel = (typeof TALK_MODELS)[number];
export const DEFAULT_TALK_MODEL: TalkModel = "s2.1-pro-free";
export const TALK_MODEL_LABEL: Record<TalkModel, string> = {
  "s2.1-pro-free": "S2.1 Pro, free",
  "s2.1-pro": "S2.1 Pro, paid",
};

/** US dollars per million UTF-8 bytes of text spoken, Fish Audio's list price (docs.fish.audio, "Pricing"). A million bytes
 *  is about 180,000 English words, or twelve hours of speech. */
export const TTS_USD_PER_MB: Record<TalkModel, number> = { "s2.1-pro-free": 0, "s2.1-pro": 15 };

/** The bytes Fish bills a piece of text as. */
export const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/** What saying `said` bytes cost through `model`. */
export const costOf = (said: number, model: TalkModel) => (said / 1e6) * TTS_USD_PER_MB[model];

/** How fast the voice talks: Fish's prosody speed, a multiplier of its natural pace (docs.fish.audio, "Text to Speech"). */
export const TALK_SPEED = { min: 0.5, max: 2, step: 0.05, normal: 1 } as const;

/** A speed as stored or sent: clamped to Fish's range, on the step; the normal pace for anything else. */
export function speedOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return TALK_SPEED.normal;
  const clamped = Math.min(TALK_SPEED.max, Math.max(TALK_SPEED.min, v));
  return Math.round(clamped / TALK_SPEED.step) * TALK_SPEED.step;
}

/** `GET /agent/talk`: the voice model, voice and speed the server talks through. `voice` is never empty while Talk is
 *  on: a voice is always pinned, or every reply would be spoken by whichever voice Fish picks for that session. */
export type TalkStatus = { model: TalkModel; voice: string; speed: number };

/** A Fish voice the owner can pick (`GET /agent/talk/voices`): its id, its name, and whether it is the owner's own. */
export type TalkVoice = { id: string; title: string; languages: string[]; mine: boolean; cover?: string; sample?: string };

export type TalkClientEvent =
  /** The first frame. `chat`: a record created in `chats` first, as for /agent/chat. `context`: what is on screen as the
   *  conversation starts. Which writes ask is the owner's preference, read by the server for every conversation (actions.ts),
   *  never a request's. */
  | { type: "start"; chat: string; context?: AssistantContext }
  /** The owner's answer to a confirm card: the tool part's `approval.id`. Only a tap answers one: what the ear heard is
   *  never an approval, or a page it read could say yes for the owner. */
  | { type: "approval"; id: string; approved: boolean; reason?: string }
  /** The app's answer to a tool it does itself (open_note, open_task, go_view, ask_choice): a UiOutputOf of that tool. */
  | { type: "output"; toolCallId: string; output: unknown };

/** One part of a message, as the chat holds it (the AI SDK's UIMessage part): `text` for what was said, a tool part in its
 *  states for what was done. */
export type TalkPart = { type: string } & Record<string, unknown>;

export type TalkServerEvent =
  /** The ear is listening: send the microphone from now on. */
  | { type: "ready" }
  /** Part `index` of message `message` is now `part` (the message is new, and goes last, when the id is). Sent again as a
   *  part grows: words as they are said, a tool as it moves from asked to done. */
  | { type: "part"; message: string; role: "user" | "assistant"; index: number; part: TalkPart }
  /** The owner started talking, or stopped: what the page draws, and what stops the voice (`interrupted` follows when it
   *  was still speaking). */
  | { type: "hearing"; speaking: boolean }
  /** The owner spoke over the voice: drop the audio not yet played. */
  | { type: "interrupted" }
  /** What the conversation has used so far: bytes of text spoken, and their cost in US dollars at the model's list price. */
  | { type: "usage"; said: number; cost: number }
  /** The conversation failed; the socket closes after it. */
  | { type: "error"; message: string };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.length >= 1 && v.length <= max ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const ID_MAX = 200, REASON_MAX = 500, MESSAGE_MAX = 2000;

/** A frame's JSON as either side sent it; null when it is not JSON. */
function frame(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return obj(raw);
  try { return obj(JSON.parse(raw)); } catch { return null; }
}

/** A text frame from the app; null when it is none of the events. */
export function talkClientEventOf(raw: unknown): TalkClientEvent | null {
  const o = frame(raw);
  if (!o) return null;
  if (o.type === "start") {
    const chat = text(o.chat, 64), context = contextOf(o.context);
    return chat ? { type: "start", chat, ...(context && { context }) } : null;
  }
  if (o.type === "approval") {
    const id = text(o.id, ID_MAX), reason = text(o.reason, REASON_MAX);
    return id && typeof o.approved === "boolean" ? { type: "approval", id, approved: o.approved, ...(reason && { reason }) } : null;
  }
  if (o.type === "output") {
    const toolCallId = text(o.toolCallId, ID_MAX);
    return toolCallId && "output" in o ? { type: "output", toolCallId, output: o.output } : null;
  }
  return null;
}

/** A text frame from the agent; null when it is none of the events. */
export function talkServerEventOf(raw: unknown): TalkServerEvent | null {
  const o = frame(raw);
  if (!o) return null;
  if (o.type === "ready" || o.type === "interrupted") return { type: o.type };
  if (o.type === "hearing") return typeof o.speaking === "boolean" ? { type: "hearing", speaking: o.speaking } : null;
  if (o.type === "part") {
    const message = text(o.message, ID_MAX), part = obj(o.part);
    const role = o.role === "user" || o.role === "assistant" ? o.role : null;
    return message && role && Number.isSafeInteger(o.index) && (o.index as number) >= 0 && part && typeof part.type === "string"
      ? { type: "part", message, role, index: o.index as number, part: part as TalkPart } : null;
  }
  if (o.type === "usage") return { type: "usage", said: count(o.said), cost: count(o.cost) };
  if (o.type === "error") return { type: "error", message: typeof o.message === "string" ? o.message.slice(0, MESSAGE_MAX) : "" };
  return null;
}

/** `GET /agent/talk`'s body; null when it names no voice model. */
export function talkStatusOf(raw: unknown): TalkStatus | null {
  const o = obj(raw), model = TALK_MODELS.find((m) => m === o?.model);
  return o && model ? { model, voice: typeof o.voice === "string" ? o.voice : "", speed: speedOf(o.speed) } : null;
}

const url = (v: unknown) => (typeof v === "string" && v.startsWith("https://") && v.length <= 2000 ? v : undefined);

/** `GET /agent/talk/voices`' body: the voices that name an id and a title, the rest dropped. */
export function talkVoicesOf(raw: unknown): TalkVoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => {
    const o = obj(v), id = text(o?.id, ID_MAX), title = text(o?.title, 200);
    if (!o || !id || !title) return [];
    const cover = url(o.cover), sample = url(o.sample);
    const languages = Array.isArray(o.languages) ? o.languages.filter((l): l is string => typeof l === "string").slice(0, 20) : [];
    return [{ id, title, languages, mine: o.mine === true, ...(cover && { cover }), ...(sample && { sample }) }];
  });
}
