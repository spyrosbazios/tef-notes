// The microphone as a stream of mono float frames at a sample rate of our choosing: an AudioWorklet tap on a MediaStream, with the
// browser's echo cancellation, noise suppression and gain control on (Talk plays the voice through the speaker while this is open).
// Dictation (hooks/dictation.ts, 16 kHz) and Talk (hooks/talk.ts) both record through it.
import { rms } from "@/lib/pcm";

/** The worklet that hands the page the microphone's samples, `frame` of them at a time. */
const TAP = `registerProcessor("tap", class extends AudioWorkletProcessor {
  constructor(o) { super(); this.n = o.processorOptions.frame; this.buf = new Float32Array(this.n); this.at = 0; }
  process([input]) {
    const ch = input[0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.at++] = ch[i]; if (this.at === this.n) { this.port.postMessage(this.buf); this.buf = new Float32Array(this.n); this.at = 0; } }
    return true;
  }
});`;

export type Mic = {
  /** While muted the track is disabled: the browser sends silence and shows the microphone as quiet. */
  mute: (on: boolean) => void;
  /** Stops the tracks and closes the audio context. */
  close: () => void;
};

export const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/** Words for a refusal or a missing microphone; null for any other failure. */
export function micTrouble(e: unknown): string | null {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) return "Microphone access was refused. Allow it in the browser's site settings.";
  if (e instanceof DOMException && e.name === "NotFoundError") return "No microphone found.";
  return null;
}

/** Opens the microphone: `onFrame` gets `frame` samples at `rate` Hz at a time. The audio context is made before the first await, so
 *  it is still inside the tap that asked (the browser's autoplay rule); it throws, with everything closed again, when it can't open. */
export async function openMic({ rate, frame, onFrame }: { rate: number; frame: number; onFrame: (samples: Float32Array) => void }): Promise<Mic> {
  const ctx = new AudioContext({ sampleRate: rate });
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    const tap = new AudioWorkletNode(ctx, "tap", { channelCount: 1, channelCountMode: "explicit", processorOptions: { frame } });
    ctx.createMediaStreamSource(stream).connect(tap);
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
    const tracks = stream.getAudioTracks(), all = stream.getTracks();
    return {
      mute: (on) => tracks.forEach((t) => { t.enabled = !on; }),
      close: () => { tap.port.onmessage = null; all.forEach((t) => t.stop()); void ctx.close(); },
    };
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
}

/** A frame's loudness as the meters show it (speech sits low in the range, so it is lifted): 0..1. */
export const loudness = (frame: Float32Array): number => Math.min(1, rms(frame) * 4);
