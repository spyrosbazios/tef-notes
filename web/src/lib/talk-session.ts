// The Talk engine: one spoken conversation with the assistant, from the Start tap to End, as a store the page and the live pill read
// (`subscribe`/`snapshot`). It speaks the contract in core/talk.ts over one WebSocket to the agent and nothing else: the
// microphone goes up as PCM from `ready` on, the voice comes down and is played, what was said and done comes down as the chat's own
// message parts (lib/talk.ts), and the UI tools (open_note, go_view, ...) are done in the app and answered. The one thing it never
// does by itself is approve: `approve` is called by a tap on a card, and by nothing the model said or heard.
// It owns no browser API: the socket, microphone, voice, wake lock and the app's own tools come in as `Deps` (hooks/talk.tsx makes the
// real ones), so test/talk-session.test.ts runs a whole conversation over fakes. Everything it opens is closed again on every way out:
// End, an error, the socket closing, a failed start.
import type { UIMessage } from "ai";
import { choiceFrom, isAskTool, isUiTool, uiError, type AssistantContext, type ChoiceOutput } from "@/core/assistant";
import { talkServerEventOf, TALK_RATE, type TalkClientEvent } from "@/core/talk";
import { isAppTool, type AppTool } from "@/lib/assistant";
import { isTool, toolName } from "@/lib/ask";
import { loudness, micTrouble, type Mic } from "@/lib/mic";
import { pcm16 } from "@/lib/pcm";
import { answeredPart, talkStateOf, withPart, type Phase, type TalkState } from "@/lib/talk";
import type { Voice } from "@/lib/talk-voice";

/** Samples of microphone in each frame sent: 50 ms, in the contract's 20 to 100. */
export const MIC_FRAME = TALK_RATE.mic / 20;

/** How long a conversation waits for the agent's `ready` before it gives up. */
const READY_MS = 20_000;
/** How long the voice may be silent before the conversation stops showing it speaking: a breath between frames isn't the end. */
const SPEAK_HOLD_MS = 300;

/** What the engine needs of the outside; the web's own are in hooks/talk.tsx. */
export type Deps = {
  /** Opens the socket to the agent; `on` hears it. */
  open: (on: { open: () => void; message: (data: string | ArrayBuffer) => void; close: () => void }) => { send: (data: string | ArrayBuffer) => void; close: () => void };
  /** Opens the microphone; `onFrame` gets `MIC_FRAME` samples at a time. Called in the Start tap, before anything is awaited. */
  mic: (onFrame: (samples: Float32Array) => void) => Promise<Mic>;
  /** Opens the voice; `on` says whether it is playing. Called in the Start tap too. */
  voice: (on: (playing: boolean) => void) => Voice;
  /** Makes the conversation's chat record, as the Ask panel does, and gives its id. */
  chat: () => Promise<string>;
  /** What is on screen as the conversation starts, and the owner's setting for notes written without asking. */
  context: () => AssistantContext;
  writesWithoutAsking: () => boolean;
  /** Does one of the app's own tools (navigation, drawing) and says how it went. */
  tool: (name: AppTool, input: unknown) => Promise<unknown>;
  /** Keeps the screen on; the returned function lets it go. */
  awake: () => () => void;
  now: () => number;
};

export type Failure = { message: string; /** The microphone was refused or is missing: the page says how to allow it. */ mic: boolean };

export type Usage = { input: number; output: number; cost: number };

export type TalkSnapshot = {
  phase: Phase;
  state: TalkState;
  messages: UIMessage[];
  muted: boolean;
  failure: Failure | null;
  usage: Usage | null;
  /** When the conversation went live, and when it ended (ms), for the clock. */
  startedAt: number | null;
  endedAt: number | null;
  /** The chat it was saved to. */
  chat: string | null;
};

/** How loud each side is right now, 0..1: read a frame at a time by what draws them (no React render in between). */
export type Levels = { mic: number; voice: number };

const IDLE: TalkSnapshot = { phase: "idle", state: "idle", messages: [], muted: false, failure: null, usage: null, startedAt: null, endedAt: null, chat: null };

export type TalkSession = {
  subscribe: (cb: () => void) => () => void;
  snapshot: () => TalkSnapshot;
  levels: () => Levels;
  start: () => void;
  end: () => void;
  mute: (on: boolean) => void;
  /** A tap on a confirm card: the call's `approval.id`. */
  approve: (id: string, approved: boolean, reason?: string) => void;
  /** A tap on an `ask_choice`'s buttons. */
  choose: (toolCallId: string, output: ChoiceOutput) => void;
};

export function createSession(deps: Deps): TalkSession {
  let snap = IDLE;
  const listeners = new Set<() => void>();
  // What a run holds open; all of it is let go by `teardown`
  let run = 0, link: ReturnType<Deps["open"]> | null = null, mic: Mic | null = null, voice: Voice | null = null;
  let release: (() => void) | null = null, giveUp: ReturnType<typeof setTimeout> | undefined, hush: ReturnType<typeof setTimeout> | undefined;
  let ready = false, playing = false, micLevel = 0;
  const done = new Set<string>(), answered = new Set<string>();

  const set = (patch: Partial<TalkSnapshot>) => {
    const next = { ...snap, ...patch };
    next.state = talkStateOf(next.phase, playing, next.messages);
    snap = next;
    listeners.forEach((l) => l());
  };
  const send = (e: TalkClientEvent) => link?.send(JSON.stringify(e));

  /** Lets everything go, and lets whatever the run still has coming (a socket's last events, a tool's answer) fall on nothing. */
  const teardown = () => {
    run++;
    clearTimeout(giveUp);
    clearTimeout(hush);
    ready = false;
    playing = false;
    micLevel = 0;
    const [m, v, l, r] = [mic, voice, link, release];
    mic = voice = link = release = null;
    m?.close();
    v?.close();
    l?.close();
    r?.();
  };

  const fail = (message: string, fromMic = false) => {
    teardown();
    set({ phase: "failed", failure: { message: message || "The conversation failed.", mic: fromMic }, endedAt: deps.now() });
  };

  const speaking = (on: boolean) => {
    clearTimeout(hush);
    if (on) { playing = true; set({}); return; }
    hush = setTimeout(() => { playing = false; set({}); }, SPEAK_HOLD_MS);
  };

  /** A tool the app does itself comes down asked for, with its input complete: do it once, answer once. */
  const tool = (m: UIMessage) => {
    for (const p of m.parts) {
      if (!isTool(p) || p.state !== "input-available" || done.has(p.toolCallId)) continue;
      const name = toolName(p), { toolCallId } = p;
      if (!isUiTool(name)) continue;
      if (isAskTool(name)) {
        // The owner answers the question, by tap: one that can never be drawn is answered here so it isn't left open
        if (!choiceFrom(p.input)) { done.add(toolCallId); send({ type: "output", toolCallId, output: uiError("The question was malformed: it needs a question and 2 to 6 options.") }); }
        continue;
      }
      if (!isAppTool(name)) continue;
      done.add(toolCallId);
      const mine = run;
      deps.tool(name, p.input)
        .catch((e: unknown) => uiError(e instanceof Error ? e.message : String(e)))
        .then((output) => { if (mine === run) send({ type: "output", toolCallId, output }); });
    }
  };

  const hear = (data: string | ArrayBuffer) => {
    if (typeof data !== "string") { if (ready) voice?.push(data); return; }
    const e = talkServerEventOf(data);
    if (!e) return;
    if (e.type === "ready") {
      clearTimeout(giveUp);
      ready = true;
      release = deps.awake();
      set({ phase: "live", startedAt: deps.now() });
    } else if (e.type === "part") {
      const messages = withPart(snap.messages, e);
      set({ messages });
      const m = messages.find((x) => x.id === e.message);
      if (m) tool(m);
    } else if (e.type === "interrupted") {
      voice?.flush();
      clearTimeout(hush);
      playing = false;
      set({});
    } else if (e.type === "usage") {
      set({ usage: { input: e.input, output: e.output, cost: e.cost } });
    } else if (e.type === "error") {
      fail(e.message);
    }
  };

  const frame = (samples: Float32Array) => {
    micLevel = snap.muted ? 0 : loudness(samples);
    if (ready && !snap.muted) link?.send(pcm16(samples));
  };

  const start = () => {
    if (snap.phase === "connecting" || snap.phase === "live") return;
    const mine = ++run;
    done.clear();
    answered.clear();
    snap = { ...IDLE, phase: "connecting" };
    set({});
    // Both audio paths open before anything is awaited, so they are still inside the tap that started this
    let heard: Promise<Mic>;
    try { voice = deps.voice(speaking); heard = deps.mic(frame); } catch (e) { return fail(e instanceof Error ? e.message : "The browser can't play or record audio here."); }
    void (async () => {
      let opened: Mic;
      try { opened = await heard; } catch (e) {
        if (mine === run) fail(micTrouble(e) ?? (e instanceof Error ? e.message : "The microphone couldn't be opened."), true);
        return;
      }
      if (mine !== run) { opened.close(); return; }
      mic = opened;
      // The record comes after the microphone, so a refusal leaves no empty chat behind
      let id: string;
      try { id = await deps.chat(); } catch (e) {
        if (mine === run) fail(e instanceof Error ? e.message : "The conversation couldn't be started.");
        return;
      }
      if (mine !== run) return;
      set({ chat: id });
      giveUp = setTimeout(() => { if (mine === run) fail("The server didn't answer in time."); }, READY_MS);
      link = deps.open({
        open: () => { if (mine === run) send({ type: "start", chat: id, context: deps.context(), writesWithoutAsking: deps.writesWithoutAsking() }); },
        message: (data) => { if (mine === run) hear(data); },
        close: () => { if (mine === run) fail(ready ? "The connection was lost." : "Couldn't reach the server."); },
      });
    })();
  };

  return {
    subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    snapshot: () => snap,
    levels: () => ({ mic: micLevel, voice: voice?.level() ?? 0 }),
    start,
    end: () => {
      if (snap.phase !== "connecting" && snap.phase !== "live") return;
      teardown();
      set({ phase: "idle", endedAt: deps.now() });
    },
    mute: (on) => { mic?.mute(on); set({ muted: on }); },
    approve: (id, approved, reason) => {
      if (answered.has(id) || snap.phase !== "live") return;
      answered.add(id);
      send({ type: "approval", id, approved, ...(reason ? { reason } : {}) });
      set({ messages: answeredPart(snap.messages, id, { approved, reason }) });
    },
    choose: (toolCallId, output) => {
      if (answered.has(toolCallId) || snap.phase !== "live") return;
      answered.add(toolCallId);
      send({ type: "output", toolCallId, output });
      set({ messages: answeredPart(snap.messages, toolCallId, { output }) });
    },
  };
}
