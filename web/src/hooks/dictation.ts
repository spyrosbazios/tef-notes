// Dictation: the microphone recorded as mono 16 kHz float32 (core/voice.ts) until stopped, cut at pauses into pieces
// (`cutOf`) that are sent one after another while the owner goes on talking, so stopping waits only for the last piece;
// their texts, joined, handed to `onText`. Nothing is kept: a piece lives in memory until it is sent. While recording,
// `level` (0..1) follows the voice and `seconds` counts up; at MAX_SECONDS it stops by itself.
import { haptic } from "@/lib/haptics";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cutOf, joined, MAX_SECONDS, RATE, spliced } from "@/core/voice";
import { prefsNow } from "@/hooks/prefs";
import { message } from "@/services/api";
import { transcribe, warm } from "@/services/voice";

export type DictationState = "idle" | "starting" | "recording" | "transcribing";

/** The worklet that hands the page the microphone's samples, ~a tenth of a second at a time. */
const TAP = `registerProcessor("tap", class extends AudioWorkletProcessor {
  buf = new Float32Array(1600); at = 0;
  process([input]) {
    const ch = input[0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.at++] = ch[i]; if (this.at === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(1600); this.at = 0; } }
    return true;
  }
});`;

type Live = {
  stream: MediaStream; ctx: AudioContext; tap: AudioWorkletNode; tick: ReturnType<typeof setInterval>;
  /** Samples not yet sent, and the pieces' texts so far, in order (a chain of sends, one at a time). */
  frames: Float32Array[]; held: number; texts: Promise<string[]>;
  /** Stopped (sent or dropped): later stops and cancels do nothing. */
  ended: boolean; cancelled: boolean;
};

const flat = (frames: Float32Array[], n: number) => {
  const out = new Float32Array(n);
  let at = 0;
  for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
};

const why = (e: unknown) => {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) return "Microphone access was refused. Allow it in the browser's site settings.";
  if (e instanceof DOMException && e.name === "NotFoundError") return "No microphone found.";
  if (isAxiosError(e) && e.response?.status === 404) return "Voice input is off on this server.";
  if (isAxiosError(e) && e.response?.status === 502) return "The speech model is unavailable right now.";
  return message(e);
};

export const canDictate = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [level, setLevel] = useState(0), [seconds, setSeconds] = useState(0);
  const live = useRef<Live | null>(null), cb = useRef(onText);
  useEffect(() => { cb.current = onText; });

  /** The samples held so far, `n` of them sent as a piece; the rest kept. */
  const send = useCallback((l: Live, n: number) => {
    const all = flat(l.frames, l.held);
    const piece = all.slice(0, n);
    l.frames = [all.slice(n)];
    l.held -= n;
    const keep = prefsNow().voice.keep;
    l.texts = l.texts.then(async (texts) => (l.cancelled ? texts : [...texts, await transcribe(piece, keep)]));
  }, []);

  const finish = useCallback(async (l: Live) => {
    if (l.ended) return;
    l.ended = true;
    clearInterval(l.tick);
    l.tap.port.onmessage = null;
    l.stream.getTracks().forEach((t) => t.stop());
    void l.ctx.close();
    setLevel(0);
    if (l.cancelled) { live.current = null; setState("idle"); return; }
    setState("transcribing");
    if (l.held) send(l, l.held);
    try {
      const text = joined(await l.texts);
      if (text) cb.current(text);
      else toast.message("Didn't catch anything. Try again a little closer to the mic.");
    } catch (e) {
      toast.error(why(e));
    } finally {
      live.current = null;
      setState("idle");
    }
  }, [send]);

  const stop = useCallback(() => {
    const l = live.current;
    if (l) void finish(l);
  }, [finish]);

  const cancel = useCallback(() => {
    const l = live.current;
    if (!l || l.ended) return;
    l.cancelled = true;
    void finish(l);
  }, [finish]);

  const start = useCallback(async () => {
    if (live.current) return;
    setState("starting");
    void warm(prefsNow().voice.keep).catch(() => { /* the first piece's own request says why */ });
    let stream: MediaStream, ctx: AudioContext, tap: AudioWorkletNode;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      ctx = new AudioContext({ sampleRate: RATE });
      const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      tap = new AudioWorkletNode(ctx, "tap", { channelCount: 1, channelCountMode: "explicit" });
      ctx.createMediaStreamSource(stream).connect(tap);
    } catch (e) {
      setState("idle");
      toast.error(why(e));
      return;
    }
    const began = performance.now();
    const tick = setInterval(() => {
      const s = (performance.now() - began) / 1000;
      setSeconds(Math.floor(s));
      if (s >= MAX_SECONDS) stop();
    }, 250);
    const l: Live = { stream, ctx, tap, tick, frames: [], held: 0, texts: Promise.resolve([]), ended: false, cancelled: false };
    live.current = l;
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data;
      l.frames.push(f);
      l.held += f.length;
      let sum = 0;
      for (const v of f) sum += v * v;
      setLevel(Math.min(1, Math.sqrt(sum / f.length) * 4));
      const n = cutOf(flat(l.frames, l.held));
      if (n) send(l, n);
    };
    setSeconds(0);
    setState("recording");
  }, [send, stop]);

  // Leaving mid-recording drops the clip
  useEffect(() => () => { const l = live.current; if (l && !l.ended) { l.cancelled = true; void finish(l); } }, [finish]);

  const toggle = useCallback(() => { if (state === "recording") { haptic("success"); stop(); } else if (state === "idle") { haptic("start"); void start(); } }, [state, start, stop]);
  return { state, level, seconds, start, stop, cancel, toggle };
}

/** `text` put into a text field at its caret (replacing a selection), spaced from what comes before; the caret after it. */
export function dictateInto(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string, set: (v: string) => void) {
  const from = el?.selectionStart ?? value.length, to = el?.selectionEnd ?? value.length;
  const before = value.slice(0, from), piece = spliced(before, text);
  set(before + piece + value.slice(to));
  const at = from + piece.length;
  requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at, at); } });
}
