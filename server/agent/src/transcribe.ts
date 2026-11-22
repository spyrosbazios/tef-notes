// Voice input, the agent's half (the contract is packages/core/src/voice.ts): a piece of dictation's raw samples go to Fish
// Audio's speech-to-text (fish.ts `hear`) and its text comes back. The agent keeps nothing of it: no recording, no text. It
// does leave the server, for Fish, for as long as the request takes — the one thing dictation used to keep at home (the stt
// container it replaced). Without a Fish key voice input is off: the route answers 404 and the clients hide their mic.
import { MAX_SECONDS, RATE, transcriptOf } from "@/core/voice";
import { dictationCostOf } from "@/core/fish-usage";
import { hear, why } from "./fish";
import { fishLedger } from "./fish-usage";
import { key } from "./keys";

const MAX_BYTES = MAX_SECONDS * RATE * 4;

const off = () => new Response("Voice input is off", { status: 404 });
const down = (e: unknown) => {
  console.error(`agent: speech to text failed: ${why(e)}`);
  return new Response("Speech to text is unavailable", { status: 502 });
};

/** `POST /agent/transcribe`: raw mono 16 kHz float32 samples in, a Transcript out. */
export async function transcribe(req: Request): Promise<Response> {
  if (!(await key("fish"))) return off();
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("The recording is longer than ten minutes", { status: 413 });
  if (body.byteLength % 4) return new Response("The body is not float32 samples", { status: 400 });
  try {
    const samples = new Float32Array(body);
    const text = await hear(samples);
    const seconds = samples.length / RATE;
    fishLedger().record({ kind: "dictation", seconds, bytes: 0, cost: dictationCostOf(seconds) });
    return Response.json(transcriptOf({ text }));
  } catch (e) {
    return down(e);
  }
}
