// Voice input, the agent's half (the contract is packages/core/src/voice.ts): passes a clip's samples to the stt service
// (server/stt/app.py, TEF_NOTES_STT on the compose network) and its text back. The agent stores nothing of it. Without
// TEF_NOTES_STT, voice input is off: the routes answer 404 and the clients hide their mic.
import { keepOf, MAX_SECONDS, RATE, transcriptOf, type Transcript } from "@/core/voice";

const stt = () => process.env.TEF_NOTES_STT?.replace(/\/$/, "");
const MAX_BYTES = MAX_SECONDS * RATE * 4;
const keepIn = (req: Request) => keepOf(Number(new URL(req.url).searchParams.get("keep")));

const off = () => new Response("Voice input is off", { status: 404 });
const down = (e: unknown) => {
  console.error(`agent: speech to text failed: ${(e as Error).message}`);
  return new Response("Speech to text is unavailable", { status: 502 });
};

/** `POST /agent/transcribe?keep=S`: raw mono 16 kHz float32 samples in, a Transcript out. */
export async function transcribe(req: Request): Promise<Response> {
  const base = stt();
  if (!base) return off();
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("The recording is longer than ten minutes", { status: 413 });
  if (body.byteLength % 4) return new Response("The body is not float32 samples", { status: 400 });
  try {
    const r = await fetch(`${base}/transcribe?keep=${keepIn(req)}`, { method: "POST", body, signal: AbortSignal.timeout(600_000) });
    if (!r.ok) return down(new Error(`stt answered ${r.status}`));
    const out: Transcript = transcriptOf(await r.json());
    return Response.json(out);
  } catch (e) {
    return down(e);
  }
}

/** `POST /agent/transcribe/warm?keep=S`: load the model now, as recording starts. */
export async function warmSpeech(req: Request): Promise<Response> {
  const base = stt();
  if (!base) return off();
  try {
    const r = await fetch(`${base}/warm?keep=${keepIn(req)}`, { method: "POST", signal: AbortSignal.timeout(300_000) });
    return r.ok ? new Response(null, { status: 204 }) : down(new Error(`stt answered ${r.status}`));
  } catch (e) {
    return down(e);
  }
}
