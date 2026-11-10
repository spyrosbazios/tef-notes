// Drawings in the chat: the `show_drawing` widget (core/widgets.ts), a note's drawing as its saved picture, and the row a `draw`
// call leaves (core/assistant.ts "the drawing"): what it did, the drawing as it was right after (the picture its answer
// carries, which a saved chat no longer holds: then the saved one), and a way back to it. A tap opens the drawing in the editor,
// over its note.
import { ArrowUpRight, Loader2, PenTool, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { label } from "@/core/agent";
import { drawPictureOf } from "@/core/assistant";
import { noteIdOf } from "@/core/notes";
import { drawingPreview, isDrawingName } from "@/core/photos";
import type { DrawingWidget } from "@/core/widgets";
import { liveNow, openDrawing } from "@/hooks/drawing";
import { useNotes } from "@/hooks/notes";
import { photoListQuery } from "@/hooks/photos";
import { uiTrouble, uiWords } from "@/lib/assistant";
import type { ToolPart } from "@/lib/ask";
import { useNav } from "@/lib/nav";
import * as photos from "@/services/photos";
import { Shell } from "./cards";

/** The picture saved beside a note's drawing, once the note's attachments are listed; undefined without one. */
function useSaved(noteId: string, name: string | undefined): string | undefined {
  const { data } = useQuery({ ...photoListQuery(noteId), enabled: !!name });
  const p = name ? data?.find((x) => x.name === drawingPreview(name)) : undefined;
  return p ? photos.url(p) : undefined;
}

/** Opens a note's drawing in the editor: the note, then the drawing over it. */
function useOpen() {
  const { openNote } = useNav();
  return (noteId: string, name: string | null) => { openNote(noteId); openDrawing(noteId, name); };
}

function Picture({ src, alt }: { src: string | undefined; alt: string }) {
  return src
    // On the white of Excalidraw's canvas, which a dark theme turns dark with Excalidraw's own filter, as the note does
    ? <img src={src} alt={alt} loading="lazy" className="block max-h-72 w-full bg-white object-contain dark:hue-rotate-180 dark:invert-[0.93]" />
    : <div className="grid h-24 place-items-center text-faint"><PenTool className="size-5" /></div>;
}

export function DrawingView({ w }: { w: DrawingWidget }) {
  const open = useOpen(), { data, isPending } = useNotes();
  const id = noteIdOf(w.path), src = useSaved(id, w.name);
  const gone = !isPending && !data?.some((n) => n.path === w.path);
  return (
    <Shell onOpen={() => open(id, w.name)} gone={gone} label={`${w.name} in ${w.title || w.path}`}>
      <Picture src={src} alt={`Drawing in ${w.title || "a note"}`} />
      <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[13px] text-dim">
        <PenTool className="size-3.5 shrink-0" /><span className="min-w-0 truncate">{w.title || "Untitled"}</span>
      </p>
    </Shell>
  );
}

/** A `draw` call: a line saying what it did (or why it couldn't), then the drawing. */
export function DrawRow({ p }: { p: ToolPart }) {
  const open = useOpen(), { data } = useNotes();
  const i = (p.input ?? {}) as Record<string, unknown>;
  const note = data?.find((n) => n.path === i.path), name = isDrawingName(i.name) ? i.name : undefined;
  const after = p.state === "output-available" ? drawPictureOf(p.output) : null;
  const fresh = after ? `data:${after.mediaType};base64,${after.data}` : undefined, saved = useSaved(note?.note.id ?? "", name);
  const refused = p.state === "output-available" && p.output && typeof p.output === "object" && "error" in p.output ? String((p.output as { error: unknown }).error) : undefined;
  const failed = p.state === "output-error" || p.state === "output-denied" || refused !== undefined;
  const running = !failed && p.state !== "output-available";
  // Back to it: the file it names, else the one open over its note now (a new drawing has no name until it is saved)
  const live = liveNow(), target = note && (name ?? (live?.noteId === note.note.id ? live.name : null));
  const src = fresh ?? saved;
  return (
    <div className="space-y-1.5 py-0.5">
      <div className="flex items-start gap-2 text-sm text-dim">
        {running ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : failed ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0 flex-1 break-words">
          {running ? `${label("draw")}…` : failed ? uiTrouble("draw", refused ?? (p.state === "output-error" ? p.errorText : "")) : uiWords("draw", p.input, note?.note.title)}
        </span>
      </div>
      {!running && !failed && note && (src || target !== undefined) ? (
        <Shell onOpen={() => open(note.note.id, target ?? null)} gone={false} label={`the drawing in ${note.note.title}`}>
          <Picture src={src} alt={`Drawing in ${note.note.title}`} />
        </Shell>
      ) : null}
    </div>
  );
}
