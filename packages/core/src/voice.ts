// Voice input's contract: speech in, text out, through Fish Audio. The client records mono 16 kHz float32 samples (RATE)
// and, while recording, cuts them at pauses (`cutOf`) and posts each piece raw to the agent's `POST /agent/transcribe`,
// which wraps it in a WAV and sends it to Fish's speech-to-text (`transcribe-1-pro`, server/agent/src/transcribe.ts) and
// answers a Transcript; the pieces' texts are joined in order. A piece is transcribed as the next is spoken, so stopping
// waits only for the last few seconds. The agent keeps nothing: no recording, no text, only what the client puts in the
// field it dictated into. The recording itself does leave the server, for Fish, for as long as the request takes.
// Pure and platform-neutral.

export const RATE = 16_000;
/** The longest clip taken, in seconds: Fish refuses more than an hour, and a piece this long is already unusual. */
export const MAX_SECONDS = 10 * 60;

/** The route under the agent's `/agent/`. */
export const TRANSCRIBE = "transcribe";

/** Pieces are cut at a pause once they hold MIN_PIECE seconds, and at the quietest moment by MAX_PIECE (a request holds
 *  one piece, and the answer arrives before the next is due). A pause is QUIET seconds whose loudness stays under a tenth
 *  of the piece's loudest. */
export const MIN_PIECE = 6;
export const MAX_PIECE = 20;
const QUIET = 0.4;
const WINDOW = RATE / 50; // 20 ms

const rms = (pcm: Float32Array, from: number) => {
  let sum = 0;
  for (let i = from; i < from + WINDOW; i++) sum += pcm[i] ** 2;
  return Math.sqrt(sum / WINDOW);
};

/** Where to cut the samples recorded so far into a piece to send: the sample count, 0 for not yet. Cuts at the end of a
 *  pause once MIN_PIECE is held, else, at MAX_PIECE, at the middle of the quietest window in the second half. */
export function cutOf(pcm: Float32Array): number {
  if (pcm.length < MIN_PIECE * RATE) return 0;
  const windows = Math.floor(pcm.length / WINDOW);
  const level = Array.from({ length: windows }, (_, w) => rms(pcm, w * WINDOW));
  const floor = Math.max(...level) / 10, quiet = Math.round(QUIET * 50);
  if (level.length >= quiet && level.slice(-quiet).every((l) => l <= floor)) return windows * WINDOW;
  if (pcm.length < MAX_PIECE * RATE) return 0;
  let best = Math.floor(windows / 2);
  for (let w = best; w < windows; w++) if (level[w] < level[best]) best = w;
  return best * WINDOW + WINDOW / 2;
}

/** The pieces' texts as one: in order, the empty ones dropped. */
export const joined = (texts: string[]) => texts.map((t) => t.trim()).filter(Boolean).join(" ");

type Transcript = { text: string };

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
