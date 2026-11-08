// A share from another app (core/share.ts), held between the service worker that receives it and the Share page, and the
// ways the page files it that aren't the clip routes': a note of its own for what they don't take (PDFs, several photos),
// and the files-only note the assistant is pointed at.
import type { QueryClient } from "@tanstack/react-query";
import { noteIdOf, parseNote } from "@/core/notes";
import { SHARE_CACHE } from "@/core/share-target";
import { takePost, type Posted } from "@/core/share-stash";
import { bodyFor, titleFor, type Shared } from "@/core/share";
import { localDay } from "@/core/time";
import { addFiles } from "./photos";
import { createNote, write } from "./notes";
import { persisted } from "./store";

let taken: Promise<Posted | null> | undefined;

/** The share the service worker stashed, taken out of the stash. Asked again (React runs an effect twice in development) it
 *  gives the same answer: the stash is emptied by the first. A share is always a fresh load of the page, so this lives as
 *  long as that share does. */
export function takeShared(): Promise<Posted | null> {
  taken ??= caches.open(SHARE_CACHE).then(takePost).catch(() => null);
  return taken;
}

/** "Add a summary" on a link or picture: this browser's choice, off until ticked (the phone's, too). */
export const clipSummary = persisted<{ on: boolean }>("tefnotes.clip", (p) => ({ on: p.on === true }));

const two = (n: number) => String(n).padStart(2, "0");

/** `body` with `lines` after it, as the phone adds the photos and PDFs it attached under what it wrote. */
const withLines = (path: string, text: string, lines: string): string => {
  const body = parseNote(path, text).body;
  return text.slice(0, text.length - body.length) + `${body.trimEnd()}\n\n${lines}\n`.replace(/^\n+/, "");
};

/** The share as a note of its own, the owner's words first: the link and text as the body, the photos and PDFs attached
 *  under them. `filesOnly`: a note for the files alone, titled by the clock, for the assistant to retitle. `files` are the
 *  stash's, which the share's images and PDFs point at by place. Resolves to the note's path. */
export async function saveShared(qc: QueryClient, s: Shared, files: File[], pageTitle: string | null, note: string, filesOnly = false): Promise<string> {
  const d = new Date(), words = [note.trim(), s.text].filter(Boolean).join("\n\n");
  const rec = filesOnly
    ? await createNote(qc, `Photos ${localDay()} ${two(d.getHours())}:${two(d.getMinutes())}`)
    : await createNote(qc, titleFor(s, pageTitle), bodyFor({ ...s, text: words }, pageTitle));
  const mine = [...s.images, ...s.pdfs].map((f) => Number(f.uri)).sort((a, b) => a - b).map((i) => files[i]);
  const lines = await addFiles(qc, noteIdOf(rec.path), mine);
  if (lines) await write(qc, rec, (text) => withLines(rec.path, text, lines));
  return rec.path;
}
