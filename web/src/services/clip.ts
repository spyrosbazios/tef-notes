// Filing a share through the server's clip routes (core/clip.ts has the shapes, extension/AGENTS.md the contract): suggest
// where JEV would put it, then save where the owner chose. A model is behind each, so they wait longer than a read, and
// neither is retried: a save that failed after landing would land twice. Failures are the server's `{error}` (`message`).
import { saveBody, suggestBody, type ClipPage, type ClipResult, type Suggestions, type Target } from "@/core/clip";
import { api } from "./api";

const CLIP_MS = 120_000;

/** Where the share fits among the notes and open tasks; writes nothing. `look`: the picture as JEV sees it (base64 JPEG). */
export async function suggest(page: ClipPage, note: string, look: string | undefined, signal: AbortSignal): Promise<Suggestions> {
  return (await api.post("tefnotes/clip/suggest", suggestBody(page, note, look), { signal, timeout: CLIP_MS })).data;
}

/** Saved where `target` says. `file`: the picture's JPEG, sent for a note, a new note or a new task (`sendsFile`), never for
 *  an existing task. `summary`: the owner ticked "Add a summary"; `tags` are the owner's. */
export async function save(page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[], file?: Blob): Promise<ClipResult> {
  const form = new FormData();
  form.append("@jsonPayload", JSON.stringify(saveBody(page, line, target, note, summary, tags)));
  if (file) form.append("file", file, "clip.jpg");
  return (await api.post("tefnotes/clip", form, { timeout: CLIP_MS })).data;
}
