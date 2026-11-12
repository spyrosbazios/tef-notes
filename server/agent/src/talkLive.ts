// Talk's speech model (talk.ts holds the conversation): the one place that knows Gemini's Live API. The session logic talks to
// a `Connect`: give it the setup and a listener, get a `LiveLink` back once the model is set up, and the model's side arrives as
// `LiveEvent`s, in the words of this app (the voice, what was heard and said, a tool call, usage). The tests hand talk.ts a fake
// Connect, so nothing in them reaches Google.
// Wire facts (docs: aistudio.google.com/docs/live-api, the SDK's types are @google/genai's): audio in is 16 kHz 16-bit mono PCM
// sent as realtime input, audio out 24 kHz; a connection lives about ten minutes and a GoAway comes first; a session resumes on
// a new connection from the last handle the server called resumable; an audio session stops at 15 minutes unless the context
// window is compressed; tool responses answer a call by its `id`.
import {
  GoogleGenAI, Modality, type FunctionDeclaration, type FunctionResponse, type LiveServerMessage, type ModalityTokenCount, type UsageMetadata,
} from "@google/genai";
import { TALK_RATE } from "@/core/talk";
import { key } from "./keys";

/** The model Talk speaks through unless TEF_NOTES_TALK_MODEL names another. */
export const TALK_MODEL = process.env.TEF_NOTES_TALK_MODEL || "gemini-3.8-live";

/** US dollars per million tokens, Gemini API paid tier, as of 2026-11-12 (ai.google.dev/gemini-api/docs/pricing, the row shared by
 *  gemini-3.8-live and its extended-thinking sibling). Output text includes thinking and the transcripts. Nothing is cached:
 *  the model's context is billed again with every turn (see talk.ts). */
export const RATES = {
  input: { TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 },
  output: { TEXT: 4.5, AUDIO: 12 },
} as const;

/** Tokens a response used, by modality ("TEXT", "AUDIO" …). */
export type Usage = { input: Record<string, number>; output: Record<string, number> };

const sum = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0);
export const tokensOf = (u: Usage) => ({ input: sum(u.input), output: sum(u.output) });

/** What a response cost at `RATES`; a modality it has no rate for is billed as text. */
export function costOf(u: Usage): number {
  const price = (by: Record<string, number>, rates: Record<string, number>) => Object.entries(by).reduce((a, [m, n]) => a + n * (rates[m] ?? rates.TEXT), 0);
  return (price(u.input, RATES.input) + price(u.output, RATES.output)) / 1e6;
}

/** The server's per-modality counts, or `total` as `fallback` when it sent none. */
function byModality(details: ModalityTokenCount[] | undefined, total: number | undefined, fallback: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of details ?? []) if (d.modality && d.tokenCount) out[d.modality] = (out[d.modality] ?? 0) + d.tokenCount;
  if (!details?.length && total) out[fallback] = total;
  return out;
}

/** One response's usage: the prompt (the whole context of the turn, tool use too) and what came back, thoughts as text. */
export function usageOf(u: UsageMetadata): Usage {
  const input = byModality(u.promptTokensDetails, u.promptTokenCount, "TEXT");
  if (u.toolUsePromptTokenCount) input.TEXT = (input.TEXT ?? 0) + u.toolUsePromptTokenCount;
  const output = byModality(u.responseTokensDetails, u.responseTokenCount, "AUDIO");
  if (u.thoughtsTokenCount) output.TEXT = (output.TEXT ?? 0) + u.thoughtsTokenCount;
  return { input, output };
}

export type LiveCall = { id: string; name: string; args: unknown };

export type LiveEvent =
  /** The voice: raw 24 kHz PCM, as it came. */
  | { type: "voice"; pcm: Uint8Array }
  /** A piece of what the owner said / of what the voice said, as text: with no promise on their order against each other. */
  | { type: "heard"; text: string }
  | { type: "said"; text: string }
  /** The owner spoke over the voice: what it was saying is dropped. */
  | { type: "interrupted" }
  /** The model finished a turn. */
  | { type: "turnComplete" }
  | { type: "calls"; calls: LiveCall[] }
  /** Calls the model withdrew: they should not run (the owner interrupted). */
  | { type: "cancelled"; ids: string[] }
  | { type: "usage"; usage: Usage }
  /** The server will end this connection soon. */
  | { type: "goAway" }
  /** A point the session can resume from, on a new connection. */
  | { type: "handle"; handle: string }
  /** The connection ended; `error` when it was not an orderly close. */
  | { type: "closed"; error?: string };

export type Setup = { instruction: string; tools: FunctionDeclaration[]; resume?: string };

export type LiveLink = {
  /** The microphone: 16 kHz mono PCM. */
  audio(pcm: Uint8Array): void;
  respond(responses: FunctionResponse[]): void;
  close(): void;
};

/** Opens a connection and resolves once the model has set up (nothing is sent before). `on` hears everything after. */
export type Connect = (setup: Setup, on: (e: LiveEvent) => void) => Promise<LiveLink>;

/** Compression keeps a long conversation inside the window and past the 15 minutes an audio session lasts without it: past
 *  `trigger` tokens the oldest turns go until about `target` remain (the instructions always stay). A smaller window is also
 *  a smaller bill: every turn pays for all of it. The fixed part alone (instructions, the notes index, about 40 function
 *  declarations) measured about 14k tokens plus the index, so the target leaves room for a dozen turns above it. */
const COMPRESS = { trigger: "48000", target: "32000" };
const SETUP_TIMEOUT = 15_000;

/** The events one server message holds, in the order a client wants them: voice and words before the turn's end. */
export function eventsOf(m: LiveServerMessage): LiveEvent[] {
  const out: LiveEvent[] = [], c = m.serverContent;
  for (const p of c?.modelTurn?.parts ?? []) if (p.inlineData?.data) out.push({ type: "voice", pcm: Buffer.from(p.inlineData.data, "base64") });
  if (c?.inputTranscription?.text) out.push({ type: "heard", text: c.inputTranscription.text });
  if (c?.outputTranscription?.text) out.push({ type: "said", text: c.outputTranscription.text });
  if (c?.interrupted) out.push({ type: "interrupted" });
  if (c?.turnComplete) out.push({ type: "turnComplete" });
  const calls = (m.toolCall?.functionCalls ?? []).flatMap((f) => (f.id && f.name ? [{ id: f.id, name: f.name, args: f.args ?? {} }] : []));
  if (calls.length) out.push({ type: "calls", calls });
  if (m.toolCallCancellation?.ids?.length) out.push({ type: "cancelled", ids: m.toolCallCancellation.ids });
  if (m.usageMetadata) out.push({ type: "usage", usage: usageOf(m.usageMetadata) });
  if (m.goAway) out.push({ type: "goAway" });
  const r = m.sessionResumptionUpdate;
  if (r?.resumable && r.newHandle) out.push({ type: "handle", handle: r.newHandle });
  return out;
}

/** Talk's connection to Gemini Live; the key is read on every connection (keys.ts), so a new one needs no restart. */
export const connectGemini = (model: string): Connect => async ({ instruction, tools, resume }, on) => {
  const apiKey = await key("gemini");
  if (!apiKey) throw new Error("Talk has no Gemini key");
  const setup = Promise.withResolvers<void>();
  setup.promise.catch(() => {});                                 // heard by the awaiting below, or by nobody when connect itself fails
  const timer = setTimeout(() => setup.reject(new Error("The speech model did not answer")), SETUP_TIMEOUT);
  const closed = (error?: string) => { setup.reject(new Error(error ?? "The speech model hung up")); on({ type: "closed", ...(error && { error }) }); };
  try {
    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: instruction,
        tools: [{ functionDeclarations: tools }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: { handle: resume },
        contextWindowCompression: { triggerTokens: COMPRESS.trigger, slidingWindow: { targetTokens: COMPRESS.target } },
      },
      callbacks: {
        onmessage: (m) => { if (m.setupComplete) setup.resolve(); else for (const e of eventsOf(m)) on(e); },
        onerror: (e) => closed(e.message || "The speech connection failed"),
        onclose: (e) => closed(e.code === 1000 ? undefined : e.reason || `The speech connection closed (${e.code})`),
      },
    });
    try { await setup.promise; } catch (e) { session.close(); throw e; }
    const mime = `audio/pcm;rate=${TALK_RATE.mic}`;
    return {
      audio: (pcm) => session.sendRealtimeInput({ audio: { data: Buffer.from(pcm).toString("base64"), mimeType: mime } }),
      respond: (functionResponses) => session.sendToolResponse({ functionResponses }),
      close: () => session.close(),
    };
  } finally {
    clearTimeout(timer);
  }
};
