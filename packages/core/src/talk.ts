// Talk, the spoken conversation with the assistant: the contract between the agent (server/agent/src/talk.ts) and the
// web's Talk page. The agent holds the live session with the speech model and runs the chat's own tools, checks and
// confirm cards for it (agent.ts); the app sends the microphone and plays the voice. Pure types and defensive readers, no I/O.
//   GET /agent/talk  -> TalkStatus; 404 while the server has no key for the speech model (Talk is off: the app hides it)
//   WS  /agent/talk  -> one conversation, for as long as the socket is open. Refused unless the upgrade's Origin is the
//                       server's own: no preflight guards a WebSocket the way it guards the JSON routes.
// Text frames are JSON: a TalkClientEvent up, a TalkServerEvent down. Binary frames are audio, raw 16-bit little-endian
// mono PCM: the microphone up at TALK_RATE.mic (in pieces of 20 to 100 ms), the voice down at TALK_RATE.voice.
// The app's first frame is `start`, and nothing is read before it; the microphone is sent from `ready` on. What was said
// and done comes down as the chat's own message parts (`part`), so the app draws a turn with the chat's components, and
// the agent saves the conversation to `chats` like any other. Closing the socket ends it.
import { contextOf, type AssistantContext } from "./assistant";

/** Samples per second of each direction's audio. */
export const TALK_RATE = { mic: 16_000, voice: 24_000 } as const;

/** `GET /agent/talk`: the speech model the server talks through. */
export type TalkStatus = { model: string };

export type TalkClientEvent =
  /** The first frame. `chat`: a record created in `chats` first, as for /agent/chat. `context`: what is on screen as the
   *  conversation starts. `writesWithoutAsking`: the owner's setting, as in a chat request. */
  | { type: "start"; chat: string; context?: AssistantContext; writesWithoutAsking: boolean }
  /** The owner's answer to a confirm card: the tool part's `approval.id`. Only a tap answers one: what the model heard
   *  is never an approval, or a page it read could say yes for the owner. */
  | { type: "approval"; id: string; approved: boolean; reason?: string }
  /** The app's answer to a tool it does itself (open_note, open_task, go_view, ask_choice): a UiOutputOf of that tool. */
  | { type: "output"; toolCallId: string; output: unknown };

/** One part of a message, as the chat holds it (the AI SDK's UIMessage part): `text` for what was said, a tool part in
 *  its states for what was done. */
export type TalkPart = { type: string } & Record<string, unknown>;

export type TalkServerEvent =
  /** The speech model is listening: send the microphone from now on. */
  | { type: "ready" }
  /** Part `index` of message `message` is now `part` (the message is new, and goes last, when the id is). Sent again as
   *  a part grows: words as they are said, a tool as it moves from asked to done. */
  | { type: "part"; message: string; role: "user" | "assistant"; index: number; part: TalkPart }
  /** The owner spoke over the voice: drop the audio not yet played. */
  | { type: "interrupted" }
  /** What the conversation has used so far: tokens in and out, and their cost in US dollars at the model's list price. */
  | { type: "usage"; input: number; output: number; cost: number }
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
    return chat ? { type: "start", chat, ...(context && { context }), writesWithoutAsking: o.writesWithoutAsking === true } : null;
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
  if (o.type === "part") {
    const message = text(o.message, ID_MAX), part = obj(o.part);
    const role = o.role === "user" || o.role === "assistant" ? o.role : null;
    return message && role && Number.isSafeInteger(o.index) && (o.index as number) >= 0 && part && typeof part.type === "string"
      ? { type: "part", message, role, index: o.index as number, part: part as TalkPart } : null;
  }
  if (o.type === "usage") return { type: "usage", input: count(o.input), output: count(o.output), cost: count(o.cost) };
  if (o.type === "error") return { type: "error", message: typeof o.message === "string" ? o.message.slice(0, MESSAGE_MAX) : "" };
  return null;
}

/** `GET /agent/talk`'s body; null when it names no model. */
export function talkStatusOf(raw: unknown): TalkStatus | null {
  const model = text(obj(raw)?.model, ID_MAX);
  return model ? { model } : null;
}
