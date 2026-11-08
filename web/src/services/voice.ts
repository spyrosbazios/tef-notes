// Voice input's calls (contract: core/voice.ts): a clip's samples to the agent, its text back; and the warm-up as recording
// starts. Nothing is stored anywhere.
import { transcribePath, transcriptOf, warmPath, type Keep } from "@/core/voice";
import { api } from "./api";

/** The text said in `pcm` (mono 16 kHz float32), "" for none. */
export async function transcribe(pcm: Float32Array, keep: Keep): Promise<string> {
  const r = await api.post(`/agent/${transcribePath(keep)}`, pcm.buffer, {
    baseURL: "", timeout: 600_000, headers: { "Content-Type": "application/octet-stream" },
  });
  return transcriptOf(r.data).text;
}

/** Load the model now, so the clip being recorded waits for no load. */
export const warm = (keep: Keep) => api.post(`/agent/${warmPath(keep)}`, null, { baseURL: "", timeout: 300_000 });
