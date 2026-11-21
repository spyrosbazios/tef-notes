// Filing a share through the server's clip routes (core/clip.ts has the shapes, extension/AGENTS.md the contract): suggest
// where JEV would put it, then save where the owner chose. A model is behind each, so they wait longer than a read, and
// neither is retried by the client; a save carries an id, so one the owner presses again after a lost answer lands once (the
// server answers it as the first). Failures are the server's `{error}` (api.ts `message`).
import { saveBodies, sendsFiles, suggestBody, type ClipPage, type ClipResult, type Suggestions, type Target } from "@/core/clip";
import { api } from "./api";

const CLIP_MS = 120_000;
const saves = saveBodies();

/** Where the share fits among the notes and open tasks; writes nothing. `look`: the first picture as JEV sees it (base64 JPEG). */
export async function suggest(page: ClipPage, note: string, look: string | undefined, signal: AbortSignal): Promise<Suggestions> {
  return (await api.post("tefnotes/clip/suggest", suggestBody(page, note, look), { signal, timeout: CLIP_MS })).data;
}

/** Saved where `target` says. `files`: the clip's files in order, each picture's JPEG then each PDF as it is (`clipFiles`),
 *  sent for a note, a new note or a new task (`sendsFiles`), never for an existing task. `summary`: the owner ticked "Add a
 *  summary"; `tags` are the owner's. */
export async function save(page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[], files: Blob[] = []): Promise<ClipResult> {
  const form = new FormData(), pictures = page.images?.length ?? 0;
  form.append("@jsonPayload", JSON.stringify(saves.body(page, line, target, note, summary, tags)));
  if (sendsFiles(page, target)) files.forEach((f, i) => form.append("file", f, i < pictures ? `picture-${i + 1}.jpg` : page.pdfs![i - pictures].name));
  const result = (await api.post("tefnotes/clip", form, { timeout: CLIP_MS })).data;
  saves.landed();
  return result;
}
