// A note's pictures for its list tile, palette row or chat card: up to four of its photos and PDFs (a PDF's first page,
// drawn by the agent), else the picture of its first link (the server's copy from its link preview). Each at the
// server's two thumb sizes, `blur` shown at once and `sharp` fading in over it. Looked up only once the row is
// near the screen.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { picturesOf } from "@/core/notes";
import { pdfThumbUrl, photoThumbUrl, previewPictureUrl, type Photo, type ThumbSize } from "@/core/pocketbase";
import * as photos from "@/services/photos";
import { ALL_PHOTOS } from "./photos";
import { useLinkPreview } from "./previews";

/** The rows already near the screen once in this page's life: a remounted one draws its pictures at once. */
const near = new Set<string>();

/** Whether the element has come near the screen yet (or did before, under `id`); once true, stays true. */
function useSeen<T extends Element>(id: string) {
  const ref = useRef<T>(null), [seen, setSeen] = useState(() => near.has(id));
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.add(id); setSeen(true); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, id]);
  return [ref, seen] as const;
}

const byKey = new WeakMap<Photo[], Map<string, Photo>>();

/** The photos by `note/name`; one Map per fetched list, shared by every row's `select`, not one per row. */
const indexed = (all: Photo[]) => {
  let m = byKey.get(all);
  if (!m) byKey.set(all, m = new Map(all.map((p) => [`${p.note}/${p.name}`, p])));
  return m;
};

/** One picture to draw: the URL at each size, and how it fills its box: cropped (`cover`), a page from its top (`page`), or a
 *  drawing whole (`drawing`, on its own white ground, which a dark theme turns dark as Excalidraw does). */
export type Source = { key: string; at: (size: ThumbSize) => string; fit: "cover" | "page" | "drawing" };

const here = () => ({ url: location.origin });

/** `[ref for the row, its pictures (none until near the screen), how many more it has than those]`. */
export function useNotePictures<T extends Element>(noteId: string, body: string) {
  const [ref, seen] = useSeen<T>(noteId);
  const found = useMemo(() => picturesOf(noteId, body), [noteId, body]);
  const link = found && "link" in found ? found.link : null;
  const anyPhoto = !!found && "pictures" in found && found.pictures.some((p) => "image" in p);
  const { data: all } = useQuery({ queryKey: ALL_PHOTOS, queryFn: photos.all, select: indexed, enabled: seen && anyPhoto, staleTime: 60_000 });
  const preview = useLinkPreview(link, seen);
  const sources = useMemo<Source[]>(() => {
    if (!seen) return [];
    if (link) return preview?.picture ? [{ key: preview.picture, at: (z) => previewPictureUrl(here(), preview, z)!, fit: "cover" }] : [];
    return (found && "pictures" in found ? found.pictures : []).flatMap((p): Source[] => {
      if ("pdf" in p) return [{ key: `pdf:${p.pdf}`, at: (z) => pdfThumbUrl(here(), noteId, p.pdf, z), fit: "page" }];
      const photo = all?.get(`${noteId}/${p.image}`);
      return photo ? [{ key: photo.file, at: (z) => photoThumbUrl(here(), photo, z), fit: p.drawing ? "drawing" : "cover" }] : [];
    });
  }, [seen, link, preview, found, all, noteId]);
  return [ref, sources, found && "more" in found ? found.more : 0] as const;
}
