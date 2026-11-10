// Dictation: the microphone recorded until stopped, the clip turned into what the server's speech model takes (mono
// 16 kHz float32, core/voice.ts) and sent; its text handed to `onText`. Nothing is kept: the clip lives in memory until it
// is sent. While recording, `level` (0..1) follows the voice and `seconds` counts up; at MAX_SECONDS it stops by itself.
import { haptic } from "@/lib/haptics";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_SECONDS, RATE, spliced } from "@/core/voice";
import { prefsNow } from "@/hooks/prefs";
import { message } from "@/services/api";
import { transcribe, warm } from "@/services/voice";

export type DictationState = "idle" | "starting" | "recording" | "transcribing";

type Live = { stream: MediaStream; rec: MediaRecorder; ctx: AudioContext; chunks: Blob[]; frame: number; tick: ReturnType<typeof setInterval>; cancelled: boolean };

/** `blob`, any format the browser records, as mono float32 samples at RATE. */
async function samplesOf(blob: Blob, ctx: AudioContext): Promise<Float32Array> {
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

const why = (e: unknown) => {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) return "Microphone access was refused. Allow it in the browser's site settings.";
  if (e instanceof DOMException && e.name === "NotFoundError") return "No microphone found.";
  if (isAxiosError(e) && e.response?.status === 404) return "Voice input is off on this server.";
  if (isAxiosError(e) && e.response?.status === 502) return "The speech model is unavailable right now.";
  return message(e);
};

export const canDictate = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [level, setLevel] = useState(0), [seconds, setSeconds] = useState(0);
  const live = useRef<Live | null>(null), cb = useRef(onText);
  useEffect(() => { cb.current = onText; });

  const release = useCallback(() => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.frame);
    clearInterval(l.tick);
    l.stream.getTracks().forEach((t) => t.stop());
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    const l = live.current;
    if (l && l.rec.state === "recording") l.rec.stop();
  }, []);

  const cancel = useCallback(() => {
    const l = live.current;
    if (!l) return;
    l.cancelled = true;
    if (l.rec.state === "recording") l.rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (live.current) return;
    setState("starting");
    const keep = prefsNow().voice.keep;
    void warm(keep).catch(() => { /* the clip's own request says why */ });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setState("idle");
      toast.error(why(e));
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const rec = new MediaRecorder(stream);
    const began = performance.now();
    const tick = setInterval(() => {
      const s = (performance.now() - began) / 1000;
      setSeconds(Math.floor(s));
      if (s >= MAX_SECONDS) stop();
    }, 250);
    const l: Live = { stream, rec, ctx, chunks: [], frame: 0, tick, cancelled: false };
    live.current = l;
    const meter = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      l.frame = requestAnimationFrame(meter);
    };
    l.frame = requestAnimationFrame(meter);
    rec.ondataavailable = (e) => { if (e.data.size) l.chunks.push(e.data); };
    rec.onstop = async () => {
      release();
      if (l.cancelled) { live.current = null; void ctx.close(); setState("idle"); return; }
      setState("transcribing");
      try {
        const pcm = await samplesOf(new Blob(l.chunks, { type: rec.mimeType }), ctx);
        const text = await transcribe(pcm, keep);
        if (text) cb.current(text);
        else toast.message("Didn't catch anything. Try again a little closer to the mic.");
      } catch (e) {
        toast.error(why(e));
      } finally {
        live.current = null;
        void ctx.close();
        setState("idle");
      }
    };
    setSeconds(0);
    rec.start();
    setState("recording");
  }, [release, stop]);

  // Leaving mid-recording drops the clip
  useEffect(() => () => { const l = live.current; if (l) { l.cancelled = true; if (l.rec.state === "recording") l.rec.stop(); } }, []);

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
