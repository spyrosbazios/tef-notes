// A note's photos, PDFs and drawings as URLs for the preview, and new ones added from a file pick, a paste or a drop (or drawn).
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { rewriteImagePaths } from "@/core/notes";
import { drawingName, drawingPreview, fileMarkdown, MAX_PDF, PDF, pdfName, photoMarkdown, photoName } from "@/core/photos";
import { Conflict } from "@/core/pocketbase";
import { downscale } from "@/lib/picture";
import * as photos from "@/services/photos";

export const PHOTOS = ["photos"] as const;
const listKey = (note: string) => [...PHOTOS, note] as const;
/** Every note's photos at once: the list's thumbnails (hooks/thumbs.ts). */
export const ALL_PHOTOS = [...PHOTOS, "all"] as const;

/** A note's attachments as the server lists them: what a note's page shows its pictures from, fetched ahead when a link to it is
 *  hovered or touched (the shell's loader, routes/_app.tsx). */
export const photoListQuery = (noteId: string) => queryOptions({ queryKey: listKey(noteId), queryFn: () => photos.list(noteId) });

/** The URL of each of this note's photos by name; null while the list loads or when the body shows none. */
function usePhotoUrls(noteId: string, body: string): Map<string, string> | null {
  const refs = /attachments\//.test(body);
  const { data } = useQuery({ ...photoListQuery(noteId), enabled: refs });
  return useMemo(() => (refs ? new Map((data ?? []).map((p) => [p.name, photos.url(p)])) : null), [refs, data]);
}

/** The body with its `../attachments/<id>/<name>` images pointed at the server's files. */
export function useShown(noteId: string, body: string): string {
  const byName = usePhotoUrls(noteId, body);
  return useMemo(() => (byName ? rewriteImagePaths(body, noteId, (n) => byName.get(n)) : body), [byName, body, noteId]);
}

/** The editor's image resolver: an image's `src` to the file's URL on the server. An attachment the server doesn't
 *  list (yet) gives null, an address elsewhere is its own. A new function whenever the list changes. */
export function useResolveImage(noteId: string, body: string): (src: string) => string | null {
  const byName = usePhotoUrls(noteId, body);
  return useCallback((src) => {
    if (!/(^|\/)attachments\//.test(src)) return src;
    const shown = rewriteImagePaths(src, noteId, (n) => byName?.get(n));
    return shown === src ? null : shown;
  }, [byName, noteId]);
}

/** Images and PDFs are what a note takes; anything else pasted or dropped is left alone. */
export const attachable = (f: File) => f.type.startsWith("image/") || f.type === PDF;

/** Up under the first free name `next` offers: one the server has already (Conflict) is taken, ask for another. */
async function putUnder(noteId: string, taken: Set<string>, next: () => string, blob: Blob): Promise<string> {
  for (;;) {
    const name = next();
    try { await photos.upload(noteId, name, blob); taken.add(name); return name; } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      taken.add(name);
    }
  }
}

/** The note's photo lists, stale: something was added, replaced or removed. */
const refreshed = (qc: QueryClient, noteId: string) =>
  Promise.all([qc.invalidateQueries({ queryKey: listKey(noteId) }), qc.invalidateQueries({ queryKey: ALL_PHOTOS })]);

/** Uploads the images and PDFs among `files` to the note; resolves to the body lines that show them. */
export async function addFiles(qc: QueryClient, noteId: string, files: File[]): Promise<string> {
  const mine = files.filter(attachable);
  if (!mine.length) return "";
  const taken = new Set((await photos.list(noteId)).map((p) => p.name)), lines: string[] = [];
  for (const f of mine) {
    if (f.type === PDF) {
      if (f.size > MAX_PDF) throw new Error(`${f.name} is over ${MAX_PDF / 1024 / 1024} MB.`);
      const name = await putUnder(noteId, taken, () => pdfName(f.name, taken), f);
      lines.push(fileMarkdown(noteId, name, f.name));
    } else {
      const name = await putUnder(noteId, taken, () => photoName(Date.now(), taken), await downscale(f));
      lines.push(photoMarkdown(noteId, [name]));
    }
  }
  await refreshed(qc, noteId);
  return lines.join("\n");
}

/** The same for a note on the page: the hook binds the query client and the note. */
export function useAddFiles(noteId: string) {
  const qc = useQueryClient();
  return (files: File[]) => addFiles(qc, noteId, files);
}

/** A drawing is two attachments: its Excalidraw scene (`<name>.excalidraw`, JSON) and a PNG of it (`<name>.png`) the chip and
 *  the phone show. The body links only the scene (src/editor/files.ts finds the PNG by name). */
export function useDrawings(noteId: string) {
  const qc = useQueryClient();
  return useMemo(() => ({
    /** The scene's JSON text. */
    async load(name: string): Promise<string> {
      const p = (await photos.list(noteId)).find((x) => x.name === name);
      if (!p) throw new Error("That drawing isn't on the server.");
      const res = await fetch(photos.url(p));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },

    /** A new drawing's two files up; back come its name and the body line that links it. The scene goes first and goes again
     *  if the preview fails, so there is never one without the other. */
    async create(scene: Blob, preview: Blob): Promise<{ name: string; markdown: string }> {
      const taken = new Set((await photos.list(noteId)).map((p) => p.name));
      const name = await putUnder(noteId, taken, () => drawingName("drawing", taken), scene);
      try { await photos.upload(noteId, drawingPreview(name), preview); } catch (e) {
        const rec = (await photos.list(noteId)).find((p) => p.name === name)?.rec;
        if (rec) await photos.remove(rec);
        throw e;
      }
      await refreshed(qc, noteId);
      const n = /-(\d+)\.excalidraw$/.exec(name)?.[1];
      return { name, markdown: fileMarkdown(noteId, name, n ? `Drawing ${n}` : "Drawing") };
    },

    /** An edited drawing's files replace the old ones: an attachment never changes, so they are deleted and uploaded again
     *  (a new record, so the phone drops its stale copy). If the upload fails the scene is still the caller's, who can save again. */
    async save(name: string, scene: Blob, preview: Blob): Promise<void> {
      const old = new Set([name, drawingPreview(name)]);
      for (const p of await photos.list(noteId)) if (old.has(p.name)) await photos.remove(p.rec);
      await photos.upload(noteId, name, scene);
      await photos.upload(noteId, drawingPreview(name), preview);
      await refreshed(qc, noteId);
    },
  }), [qc, noteId]);
}
