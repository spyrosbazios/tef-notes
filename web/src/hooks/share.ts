// A share from another app (core/share.ts), held between the service worker that receives it and the Share page, and the
// one way the page files it that isn't the clip routes': the files-only note the assistant is pointed at (it can't attach
// files to a chat, so they go in a note first).
import type { QueryClient } from "@tanstack/react-query";
import { parseNote } from "@/core/notes";
import { SHARE_CACHE } from "@/core/share-target";
import { takePost, type Posted } from "@/core/share-stash";
import type { Shared } from "@/core/share";
import { localDay } from "@/core/days";
import { addFiles } from "./photos";
import { createNote, write } from "./notes";

let taken: Promise<Posted | null> | undefined;

/** The share the service worker stashed, taken out of the stash. Asked again (React runs an effect twice in development) it
 *  gives the same answer: the stash is emptied by the first. A share is always a fresh load of the page, so this lives as
 *  long as that share does. */
export function takeShared(): Promise<Posted | null> {
  taken ??= caches.open(SHARE_CACHE).then(takePost).catch(() => null);
  return taken;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `body` with `lines` after it, as the phone adds the photos and PDFs it attached under what it wrote. */
const withLines = (path: string, text: string, lines: string): string => {
  const body = parseNote(path, text).body;
  return text.slice(0, text.length - body.length) + `${body.trimEnd()}\n\n${lines}\n`.replace(/^\n+/, "");
};

/** The share's photos and PDFs in a note of their own, titled by the clock for the assistant to retitle. `files` are the
 *  stash's, which the share's images and PDFs point at by place. The note goes up before its files do (`addFiles`), so they
 *  are filed under the path it keeps. Resolves to the note's path. */
export async function saveSharedFiles(qc: QueryClient, s: Shared, files: File[]): Promise<string> {
  const d = new Date();
  const rec = await createNote(qc, `Photos ${localDay(Date.now())} ${two(d.getHours())}:${two(d.getMinutes())}`);
  const mine = [...s.images, ...s.pdfs].map((f) => Number(f.uri)).sort((a, b) => a - b).map((i) => files[i]);
  const { path, lines } = await addFiles(qc, rec.path, mine);
  if (lines) await write(rec, (text, at) => withLines(at, text, lines));
  return path;
}
