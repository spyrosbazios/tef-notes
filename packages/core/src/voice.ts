// Voice input's contract: speech in, text out, on the owner's own server. The client records a clip, turns it into mono
// 16 kHz float32 samples (RATE) and posts them raw to the agent's `POST /agent/transcribe?keep=S`, which hands them to the
// stt service (server/stt/app.py: Parakeet TDT 0.6B v2, English, on the CPU) and answers a Transcript. Nothing is kept: no
// recording, no text, only what the client puts in the field it was dictated into. `POST /agent/transcribe/warm?keep=S`
// loads the model as recording starts, so the clip that follows waits for no load. `keep` is how long the model stays
// loaded once idle, the owner's setting (prefs.ts `voice.keep`). Pure and platform-neutral.

export const RATE = 16_000;
/** The longest clip taken, in seconds: the service refuses more (413), so a client stops recording here. */
export const MAX_SECONDS = 10 * 60;

/** How long the model may stay loaded once idle, in seconds: the choices Settings offers. 0 drops it after each clip. */
export const KEEPS = [0, 60, 300, 900, 1800, 3600] as const;
export type Keep = (typeof KEEPS)[number];
export const DEFAULT_KEEP: Keep = 300;
export const KEEP_LABEL: Record<Keep, string> = {
  0: "Unload right away", 60: "1 minute", 300: "5 minutes", 900: "15 minutes", 1800: "30 minutes", 3600: "1 hour",
};
export const keepOf = (v: unknown): Keep => KEEPS.find((k) => k === v) ?? DEFAULT_KEEP;

/** The routes under the agent's `/agent/`. */
export const transcribePath = (keep: Keep) => `transcribe?keep=${keep}`;
export const warmPath = (keep: Keep) => `transcribe/warm?keep=${keep}`;

export type Transcript = { text: string };

/** The server's answer as a Transcript: its text trimmed, "" when it heard nothing. */
export function transcriptOf(x: unknown): Transcript {
  const t = x && typeof x === "object" ? (x as Record<string, unknown>).text : undefined;
  return { text: typeof t === "string" ? t.trim() : "" };
}

/** `text` dictated into `before`, the field's text up to the caret: a space between them unless one is already there. */
export function spliced(before: string, text: string): string {
  if (!text) return "";
  return before && !/\s$/.test(before) ? ` ${text}` : text;
}
