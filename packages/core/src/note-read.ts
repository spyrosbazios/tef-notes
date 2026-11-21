// What the agent's read_note answers (server/agent/src/tools.ts): a file's whole text and the `rev` it was read at. A whole-file
// write (rewrite_note, update_memory) names that rev, and the text read at it is the base of a 3-way merge when the file has moved
// on since: the server merges there (application/notes.ts `change`), and the web's confirm card previews the same merge. Pure.
import { reconcile } from "./notes";

/** A file as read_note gave it. */
export type NoteRead = { path: string; rev: number; text: string };

/** A read_note answer as a `NoteRead`; null for anything else: an error, or a text clipped short of the whole file (a base must
 *  be all of it). */
export function noteReadOf(output: unknown): NoteRead | null {
  const o = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const { path, rev, text } = o;
  if (typeof path !== "string" || typeof rev !== "number" || !Number.isInteger(rev) || typeof text !== "string" || o.truncated) return null;
  return { path, rev, text };
}

/** What a whole-file write on `path`, based on the file as read at `rev`, will leave, for its confirm card: the server's merge
 *  (application/notes.ts `change`) run on `live`, the file as the app has it now (null: none yet). `make` is the write over a
 *  file's text. `merged`: edits made since the read are folded in. `problem`: the server would refuse it, because those edits
 *  overlap the write's (`overlap`), or the file moved and the text read at `rev` is no longer in view (`moved`: `reads` lack it). */
export function previewWrite(
  path: string, rev: number, reads: readonly NoteRead[], live: { rev: number; text: string } | null, make: (file: string) => string,
): { text: string; merged: boolean } | { problem: "overlap" | "moved" } {
  if (!live || live.rev === rev) return { text: make(live?.text ?? ""), merged: false };
  const base = rev === 0 ? "" : reads.find((r) => r.path === path && r.rev === rev)?.text;
  if (base == null) return { problem: "moved" };
  const text = mergedWrite(base, make(base), live.text);
  return text == null ? { problem: "overlap" } : { text, merged: true };
}

/** What a whole-file write (`mine`, made over `base`, the file at the rev the writer read) leaves when the file is `current`
 *  now: `mine` with the changes made meanwhile folded in, or null where they overlap. Unchanged since (`current` is `base`): `mine`. */
export function mergedWrite(base: string, mine: string, current: string): string | null {
  return current === base ? mine : reconcile(base, mine, current);
}
