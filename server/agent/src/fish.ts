// Fish Audio, the one place that knows it (docs: docs.fish.audio). Three things, and nothing else outside this file talks to
// api.fish.audio:
//   the voice (`connectVoice`): wss://api.fish.audio/v1/tts/live, one socket per conversation. MessagePack frames:
//     {event:"start", request} once (the request is a TTSRequest: `format: "pcm"`, `sample_rate`, the voice's `reference_id`,
//     `latency`), {event:"text", text} per chunk of the reply, {event:"flush"} to speak what is buffered now, and
//     {event:"stop"} to end it — there is no cancel, so stopping mid-reply means `stop` and a new socket. Back:
//     {event:"audio", audio: <16-bit PCM>} many times, then {event:"finish", reason}.
//   the ear (`connectEar`): wss://api.fish.audio/v1/asr/realtime, one socket per conversation, also MessagePack: a `config`
//     (16 kHz mono s16le, `turn_detection: {mode:"auto", eager:true}`), then `audio` frames as the microphone arrives,
//     `agent_speaking` as the voice starts and stops, `context_add` for each line said, and `audio_done` at the end. Back, in
//     order: `speech_start`, `user_turn_taken` (this really is the owner) or `user_backchannel` (only a "mm-hm" over the
//     voice), `eager_end_of_turn` (the turn's text, before it is
//     final), `turn_resumed` (it was not), and `committed` (the final text, and whether it was the owner's turn at all: a
//     backchannel over the voice or a noise in the room is not). It decides what a turn is, so nothing here guesses.
//   the file reader (`hear`): POST /v1/asr, `model: transcribe-1-pro`, multipart WAV — what dictation sends each piece to.
//   the balance (`credit`): GET /wallet/self/api-credit, the API credit left (a string of US dollars), for Settings' spend.
// Billing is the text's: Fish charges the bytes of what is spoken (TTS) and the session's seconds (the ear), both far below a
// speech-to-speech model's per-turn price. The key is read on every connection (keys.ts `fish`), so a new one needs no restart.
import { decode, encode } from "@msgpack/msgpack";
import { TALK_RATE, type TalkModel, type TalkVoice } from "@/core/talk";
import { RATE } from "@/core/voice";
import { key } from "./keys";

const TTS_URL = "wss://api.fish.audio/v1/tts/live";
const ASR_URL = "wss://api.fish.audio/v1/asr/realtime";
const ASR_FILE = "https://api.fish.audio/v1/asr";
const MODELS = "https://api.fish.audio/model";
const CREDIT = "https://api.fish.audio/wallet/self/api-credit";
/** The file reader: 60 minutes is its limit, and a dictation piece is seconds. */
const FILE_TIMEOUT = 120_000;
const SETUP_TIMEOUT = 20_000;
/** A session closes after 30 seconds without a client message: the ear hears nothing while the owner is quiet. */
const KEEPALIVE = 15_000;

/** The voice model, voice and pace a conversation speaks with, from the owner's preferences (prefs.ts `talk`) and the
 *  server's. `voice` is always an id: without one Fish picks a voice per session, and every reply sounded like someone else. */
export type Sea = { model: TalkModel; voice: string; speed: number };

// ---- the voice

/** Where the voice's audio goes, as it comes: raw 16-bit little-endian mono PCM at `TALK_RATE.voice`. */
export type VoiceOut = {
  audio(pcm: Uint8Array): void;
  /** The socket ended, orderly or not. What was not said will not be. */
  ended(error?: string): void;
};

export type Voice = {
  /** A piece of the reply. Fish buffers it: it speaks at its own chunk boundaries (or on `flush`). */
  say(text: string): void;
  /** Speak what is buffered now: the reply is over, or it has paused where the owner would notice. */
  flush(): void;
  /** End the session (there is no cancel): what was not spoken is dropped. */
  stop(): void;
};

/** Opens a voice socket and resolves once Fish has the session's setup. */
export type ConnectVoice = (out: VoiceOut) => Promise<Voice>;

/** A socket's failure in words, for the log and the app. */
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Why Fish refused a socket. A WebSocket's error carries no HTTP answer, so the same upgrade is asked once more over HTTP
 *  to read it: out of credit (402) and a refused key (401, 403) were all "could not be reached" before. */
async function refusal(url: string, headers: Record<string, string>, who: string): Promise<string> {
  const unreached = `${who} could not be reached`;
  try {
    const r = await fetch(url.replace(/^wss:/, "https:"), {
      headers: { ...headers, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGVmbm90ZXMtZmlzaC0xMg==" },
      signal: AbortSignal.timeout(5_000),
    });
    if (r.status === 402) return `${who} is out of Fish Audio API credit`;
    if (r.status === 401 || r.status === 403) return `Fish Audio refused the key (${r.status})`;
    if (r.ok || r.status === 101) return unreached;
    const body = await r.json().catch(() => undefined) as { message?: unknown } | undefined;
    return typeof body?.message === "string" ? `${who} was refused (${r.status}): ${body.message.slice(0, 200)}` : `${who} was refused (${r.status})`;
  } catch {
    return unreached;
  }
}

export const connectFishVoice = (sea: Sea): ConnectVoice => async (out) => {
  const apiKey = await key("fish");
  if (!apiKey) throw new Error("Talk has no Fish Audio key");
  const headers = { Authorization: `Bearer ${apiKey}`, model: sea.model };
  const ws = new WebSocket(TTS_URL, { headers } as never);
  ws.binaryType = "arraybuffer";
  const opened = Promise.withResolvers<void>();
  const setup = setTimeout(() => opened.reject(new Error("Fish's voice did not answer")), SETUP_TIMEOUT);
  let stopped = false, refused = false;
  const fail = (message: string) => { if (!stopped) { stopped = true; out.ended(message); } };
  ws.onopen = () => {
    clearTimeout(setup);
    ws.send(encode({
      event: "start",
      request: {
        text: "",                                                    // the reply arrives as TextEvents
        reference_id: sea.voice,
        prosody: { speed: sea.speed, volume: 0 },
        format: "pcm",
        sample_rate: TALK_RATE.voice,                                // the app's player is opened at this rate
        latency: "normal",                                           // Fish's most stable output, some 200 ms later than "balanced"
        temperature: 0.4,                                            // under Fish's 0.7: the delivery varies less from one passage to the next
        top_p: 0.6,
        chunk_length: 200,                                           // a reply's sentences are spoken as one passage up to this long
        condition_on_previous_chunks: true,                          // each passage takes its voice from the one before
        normalize: true,                                             // numbers, dates and units read out in words
      },
    }));
    opened.resolve();
  };
  ws.onerror = () => {
    clearTimeout(setup);
    refused = true;
    void refusal(TTS_URL, headers, "Fish's voice").then((message) => { opened.reject(new Error(message)); fail(message); });
  };
  ws.onclose = (e) => { clearTimeout(setup); if (refused) return; opened.reject(new Error(`Fish's voice hung up (${e.code})`)); fail(e.code === 1000 ? "The voice closed" : `Fish's voice hung up (${e.code})`); };
  ws.onmessage = (m) => {
    if (stopped) return;                                             // frames still arriving while a stopped socket closes are not played
    const f = decode(new Uint8Array(m.data as ArrayBuffer)) as { event?: string; audio?: Uint8Array; reason?: string };
    if (f.event === "audio" && f.audio) out.audio(new Uint8Array(f.audio));
    else if (f.event === "finish") { stopped = true; out.ended(f.reason === "error" ? "Fish's voice failed mid-sentence" : undefined); }
  };
  await opened.promise;
  return {
    say: (text) => { if (!stopped && text) ws.send(encode({ event: "text", text })); },
    flush: () => { if (!stopped) ws.send(encode({ event: "flush" })); },
    stop: () => { stopped = true; try { ws.send(encode({ event: "stop" })); ws.close(); } catch { /* already gone */ } },
  };
};

// ---- the voices

type FishModel = { _id?: unknown; title?: unknown; type?: unknown; languages?: unknown; cover_image?: unknown; samples?: unknown };

const voiceOf = (m: FishModel, mine: boolean): TalkVoice[] => {
  if (typeof m._id !== "string" || typeof m.title !== "string" || m.type !== "tts") return [];
  const sample = Array.isArray(m.samples) ? (m.samples[0] as { audio?: unknown } | undefined)?.audio : undefined;
  return [{
    id: m._id, title: m.title, mine,
    languages: Array.isArray(m.languages) ? m.languages.filter((l): l is string => typeof l === "string") : [],
    ...(typeof m.cover_image === "string" && m.cover_image.startsWith("https://") && { cover: m.cover_image }),
    ...(typeof sample === "string" && sample.startsWith("https://") && { sample }),
  }];
};

async function models(params: Record<string, string>, apiKey: string): Promise<FishModel[]> {
  const r = await fetch(`${MODELS}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(SETUP_TIMEOUT) });
  if (!r.ok) throw new Error(`Fish's voice list answered ${r.status}`);
  const body = await r.json() as { items?: unknown };
  return Array.isArray(body.items) ? body.items as FishModel[] : [];
}

/** The voices to pick from: the owner's own on Fish first (cloned or private), then the public ones, most liked first,
 *  matching `q` by name when given. */
export async function fishVoices(q: string): Promise<TalkVoice[]> {
  const apiKey = await key("fish");
  if (!apiKey) throw new Error("Talk has no Fish Audio key");
  const title: Record<string, string> = q.trim() ? { title: q.trim() } : {};
  const [own, open] = await Promise.all([
    models({ self: "true", page_size: "50", ...title }, apiKey),
    models({ page_size: "30", sort_by: "score", ...title }, apiKey),
  ]);
  const mine = own.flatMap((m) => voiceOf(m, true)), ids = new Set(mine.map((v) => v.id));
  return [...mine, ...open.flatMap((m) => voiceOf(m, false)).filter((v) => !ids.has(v.id))];
}

/** The voice a server with none chosen speaks in: the first it can list, fixed for as long as the server runs, so a
 *  conversation never changes voice between replies. */
let fallback: Promise<string> | undefined;
export function fallbackVoice(): Promise<string> {
  fallback ??= fishVoices("").then((v) => {
    if (!v[0]) throw new Error("Fish lists no voice to speak in: pick one in Settings");
    return v[0].id;
  }).catch((e) => { fallback = undefined; throw e; });
  return fallback;
}

// ---- the ear

export type EarEvent =
  /** `session_started`: audio may be sent. */
  | { type: "started" }
  /** The owner began or stopped being audible (`speech_start`, and the turn's end). */
  | { type: "speech"; on: boolean }
  /** This is the owner's turn (`user_turn_taken`). */
  | { type: "taken" }
  /** The owner only acknowledged the voice, a "mm-hm" over it (`user_backchannel`): it goes on speaking. */
  | { type: "nod" }
  /** The turn has probably ended, with its text: what `committed` will say unless `resumed` follows. */
  | { type: "eager"; text: string }
  /** The owner went on after `eager`: that text is to be dropped. */
  | { type: "resumed" }
  /** The turn ended: its final text, and whether it was the owner's turn at all. */
  | { type: "turn"; text: string; yours: boolean; degraded: boolean }
  /** The socket failed. It cannot be resumed: a new one is a new session. */
  | { type: "failed"; message: string };

export type Ear = {
  /** 16 kHz mono s16le, as the microphone gives it: 20 to 40 ms to a message, and the smaller the sooner it is read. */
  audio(pcm: Uint8Array): void;
  /** The voice started or stopped: an acknowledgement over it is a backchannel, not a turn. */
  speaking(on: boolean): void;
  /** A line the voice said, for the next turn to be heard in context. */
  said(line: string): void;
  /** No more audio: the last turn is committed and the socket closes. */
  done(): void;
  /** Over, without waiting for the last turn (a conversation that failed). */
  close(): void;
};

/** An open ear: the session, and where the conversation's handler is attached (the socket is open by then, so nothing
 *  that was said in between is lost). */
export type EarSession = Ear & { listen(l: (e: EarEvent) => void): () => void };

/** Opens an ear socket and resolves once Fish has the session's setup. `terms`: names to hear right (titles, tags). */
export type ConnectEar = (terms: string[]) => Promise<EarSession>;

const TURN_KIND = new Set(["user", "backchannel", "other"]);

export const connectFishEar = (): ConnectEar => async (terms) => {
  const apiKey = await key("fish");
  if (!apiKey) throw new Error("Talk has no Fish Audio key");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const ws = new WebSocket(ASR_URL, { headers } as never);
  ws.binaryType = "arraybuffer";
  const opened = Promise.withResolvers<void>(), listeners = new Set<(e: EarEvent) => void>();
  const setup = setTimeout(() => opened.reject(new Error("Fish's ear did not answer")), SETUP_TIMEOUT);
  let closed = false, refused = false, turns = 0;
  /** The session's listeners: `talk.ts` subscribes after the socket is open, so what came first is replayed by it. */
  const tell = (e: EarEvent) => { for (const l of listeners) l(e); };
  const fail = (message: string) => { if (closed) return; closed = true; tell({ type: "failed", message }); };
  ws.onopen = () => {
    ws.send(encode({
      type: "config",
      audio: { format: "pcm_s16le", sample_rate: RATE, channels: 1 },
      turn_detection: { mode: "auto", eager: true },
      results: { drafts: false, diarize: false, tag_audio_events: false },
      ...(terms.length ? { context: { terms: terms.slice(0, 100).map((t) => t.slice(0, 32)) } } : {}),
    }));
  };
  ws.onerror = () => {
    clearTimeout(setup);
    refused = true;
    void refusal(ASR_URL, headers, "Fish's ear").then((message) => { opened.reject(new Error(message)); fail(message); });
  };
  ws.onclose = (e) => {
    clearTimeout(setup);
    clearInterval(beat);
    if (refused) return;
    opened.reject(new Error(`Fish's ear hung up (${e.code})`));
    if (e.code !== 1000) fail(`Fish's ear hung up (${e.code})`);
  };
  ws.onmessage = (m) => {
    const f = decode(new Uint8Array(m.data as ArrayBuffer)) as Record<string, unknown>;
    const text = typeof f.text === "string" ? f.text : "";
    switch (f.type) {
      case "session_started": clearTimeout(setup); opened.resolve(); tell({ type: "started" }); break;
      case "speech_start": turns = Number(f.turn_index ?? turns); tell({ type: "speech", on: true }); break;
      case "user_turn_taken": tell({ type: "taken" }); break;
      case "user_backchannel": tell({ type: "nod" }); break;
      case "eager_end_of_turn": tell({ type: "eager", text }); break;
      case "turn_resumed": tell({ type: "resumed" }); break;
      case "committed": {
        const kind = typeof f.turn_kind === "string" && TURN_KIND.has(f.turn_kind) ? f.turn_kind : "other";
        // `user_turn` missing is the owner's (the API's own rule); a kind this build does not know is not
        tell({ type: "turn", text, yours: f.user_turn !== false && kind !== "other" && kind !== "backchannel", degraded: f.degraded === true });
        tell({ type: "speech", on: false });
        break;
      }
      case "error": fail(typeof f.message === "string" ? f.message : "Fish's ear failed"); break;
      default: break;   // drafts, vad, eot_prob, configured, session_done: not asked for, or nothing to do
    }
  };
  const beat = setInterval(() => { if (!closed && ws.readyState === WebSocket.OPEN) ws.send(encode({ type: "keepalive" })); }, KEEPALIVE);
  await opened.promise;
  return {
    audio: (pcm) => { if (!closed && ws.readyState === WebSocket.OPEN && pcm.length) ws.send(encode({ type: "audio", data: pcm })); },
    speaking: (on) => { if (!closed && ws.readyState === WebSocket.OPEN) ws.send(encode({ type: "agent_speaking", speaking: on })); },
    said: (line) => { if (!closed && ws.readyState === WebSocket.OPEN && line.trim()) ws.send(encode({ type: "context_add", items: [{ role: "assistant", text: line.slice(0, 2000) }] })); },
    done: () => { clearInterval(beat); if (!closed) try { ws.send(encode({ type: "audio_done" })); } catch { /* already gone */ } },
    close: () => { clearInterval(beat); closed = true; clearTimeout(setup); try { ws.close(); } catch { /* already gone */ } },
    /** `talk.ts` subscribes the conversation's handler after the socket is open. */
    listen: (l: (e: EarEvent) => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  } as EarSession;
};

// ---- the file reader (dictation)

/** Samples as a WAV Fish can read: 16-bit mono at `RATE` (the format is read from the bytes, not the name). */
export function wavOf(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return bytes;
}

/** The words in a piece of dictation; throws with Fish's own reason when it cannot read it. */
export async function hear(samples: Float32Array): Promise<string> {
  const apiKey = await key("fish");
  if (!apiKey) throw new Error("Voice input is off: the server has no Fish Audio key");
  const form = new FormData();
  form.append("audio", new Blob([wavOf(samples)], { type: "audio/wav" }), "piece.wav");
  form.append("ignore_timestamps", "true");
  form.append("diarize", "false");         // one speaker, and no <|speaker:0|> in a note
  form.append("tag_audio_events", "false"); // nor [laughter]
  const r = await fetch(ASR_FILE, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, model: "transcribe-1-pro" },
    body: form,
    signal: AbortSignal.timeout(FILE_TIMEOUT),
  });
  if (!r.ok) throw new Error(`Fish could not read the recording (${r.status}${await reason(r)})`);
  const out = (await r.json()) as { text?: unknown };
  return typeof out.text === "string" ? out.text.trim() : "";
}

/** The body's own `message` or `error`, for a log line; "" when there is none. */
async function reason(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { message?: unknown; error?: unknown; code?: unknown };
    const said = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
    return said ? `: ${said}` : typeof body.code === "string" ? `: ${body.code}` : "";
  } catch { return ""; }
}

export { why };

/** Fish's API credit left, in US dollars. */
export async function credit(): Promise<number> {
  const apiKey = await key("fish");
  if (!apiKey) throw new Error("no Fish Audio key");
  const r = await fetch(CREDIT, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Fish did not give the balance (${r.status}${await reason(r)})`);
  const value = Number(((await r.json()) as { credit?: unknown }).credit);
  if (!Number.isFinite(value)) throw new Error("Fish's balance is not a number");
  return value;
}
