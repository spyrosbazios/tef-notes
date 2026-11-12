// The assistant's voice: the PCM frames the agent sends (core/talk.ts, 24 kHz), played in the order they come with no gap between them.
// Each frame is an audio buffer started exactly where the one before ends (the audio clock's time, not a timer's), so a late frame
// can leave a gap but a busy page can't. `flush` drops everything not yet played at once: the owner spoke over it. The context is
// made inside the tap that starts the conversation (the browser's autoplay rule) and is its own, at the voice's rate: the
// microphone's runs at 16 kHz, and the browser's echo cancellation hears what this one plays.
import { TALK_RATE } from "@/core/talk";
import { floats, rms } from "@/lib/pcm";

/** Seconds of lead before the first frame after a silence: room for the next to arrive before the last has ended. */
const LEAD = 0.06;

export type Voice = {
  /** Queue a frame of PCM behind what is playing. */
  push: (pcm: ArrayBuffer) => void;
  /** Stop what is playing and forget what is queued. */
  flush: () => void;
  /** How loud it is now, 0..1. */
  level: () => number;
  /** Stop everything and close the context. */
  close: () => void;
};

/** `on(true)` as audio is queued after silence, `on(false)` as the last of it has played or been flushed. */
export function openVoice(on: (playing: boolean) => void): Voice {
  const ctx = new AudioContext({ sampleRate: TALK_RATE.voice, latencyHint: "interactive" });
  void ctx.resume();
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  meter.connect(ctx.destination);
  const wave = new Float32Array(meter.fftSize);
  const queued = new Set<AudioBufferSourceNode>();
  let end = 0;
  const stop = (s: AudioBufferSourceNode) => { s.onended = null; try { s.stop(); } catch { /* it never started */ } s.disconnect(); };
  return {
    push(pcm) {
      const samples = floats(pcm);
      if (!samples.length) return;
      const buffer = ctx.createBuffer(1, samples.length, TALK_RATE.voice);
      buffer.copyToChannel(samples, 0);
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(meter);
      if (end <= ctx.currentTime) end = ctx.currentTime + LEAD;
      s.start(end);
      end += buffer.duration;
      if (!queued.size) on(true);
      queued.add(s);
      s.onended = () => { queued.delete(s); s.disconnect(); if (!queued.size) on(false); };
    },
    flush() {
      if (!queued.size) return;
      queued.forEach(stop);
      queued.clear();
      end = 0;
      on(false);
    },
    level() {
      if (!queued.size) return 0;
      meter.getFloatTimeDomainData(wave);
      return Math.min(1, rms(wave) * 3);
    },
    close() {
      queued.forEach(stop);
      queued.clear();
      void ctx.close();
    },
  };
}
