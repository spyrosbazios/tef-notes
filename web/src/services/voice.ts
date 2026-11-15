// Voice input's call (contract: core/voice.ts): a piece's samples to the agent, its text back. Nothing is stored anywhere;
// the agent hands the piece to Fish Audio to be transcribed.
import { TRANSCRIBE, transcriptOf } from "@/core/voice";
import { api } from "./api";

/** The text said in `pcm` (mono 16 kHz float32), "" for none. */
export async function transcribe(pcm: Float32Array): Promise<string> {
  const r = await api.post(`/agent/${TRANSCRIBE}`, pcm.buffer, {
    baseURL: "", timeout: 600_000, headers: { "Content-Type": "application/octet-stream" },
  });
  return transcriptOf(r.data).text;
}
