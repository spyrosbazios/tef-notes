// The note body, edited as it reads: the editor module (src/editor) in a React shell. The shell owns nothing of the
// note: the body comes in as markdown and goes out as markdown; the draft hook saves it. The format tools live in the
// note pane's bar (format-tools.tsx); the shell hands the editor up to it. A click on a photo opens the lightbox, on a
// PDF chip the PDF viewer, on a drawing chip the pane's drawing dialog (`onDrawing`).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Lightbox, type LightboxItem } from "@/components/lightbox";
import { Reader } from "@/components/reader";
import { PdfViewer } from "@/components/pdf-viewer";
import { attachmentLink } from "@/core/photos";
import { noteIdOf } from "@/core/notes";
import { noteLinkPath } from "@/core/links";
import { pdfPages, pdfThumbUrl } from "@/core/pocketbase";
import { createEditor, isDrawingLink, type Editor } from "@/editor";
import { useResolveImage } from "@/hooks/photos";
import { previewQuery } from "@/hooks/previews";
import { summarize } from "@/services/summary";

export type NoteEditorHandle = {
  /** Lines of markdown (the photos and PDFs just added) at the cursor. */
  insertMarkdown: (markdown: string) => void;
  focus: (at?: "start" | "end") => void;
};

type Props = {
  noteId: string;
  /** The body. A new value that isn't what the editor last sent replaces the text (another device, a settled clash). */
  markdown: string;
  onChange: (markdown: string) => void;
  onFiles: (files: File[]) => void;
  onNote: (id: string) => void;
  /** A drawing's chip was clicked: its file name. The pane opens its editor. */
  onDrawing: (name: string) => void;
  /** The editor once it is up, null when it goes: what the note pane's format tools drive. */
  onEditor: (editor: Editor | null) => void;
  ref?: React.Ref<NoteEditorHandle>;
};

export function NoteEditor({ noteId, markdown, onChange, onFiles, onNote, onDrawing, onEditor, ref }: Props) {
  const host = useRef<HTMLDivElement>(null), editorRef = useRef<Editor | null>(null);
  const qc = useQueryClient();
  const resolve = useResolveImage(noteId, markdown);
  const resolveRef = useRef(resolve), props = useRef({ onChange, onFiles, onNote, onDrawing, onEditor }), opened = useRef(markdown), sent = useRef(markdown);
  const [pictures, setPictures] = useState<{ items: LightboxItem[]; index: number | null }>({ items: [], index: null });
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [reading, setReading] = useState<string | null>(null);

  // What the editor's callbacks read, kept current
  useEffect(() => { resolveRef.current = resolve; props.current = { onChange, onFiles, onNote, onDrawing, onEditor }; });

  // One editor per note: the host remounts it with the note id
  useEffect(() => {
    const ed = createEditor(host.current!, {
      markdown: opened.current,
      resolveImage: (src) => resolveRef.current(src),
      pdfPage: (href) => { const a = attachmentLink(href); return a ? pdfThumbUrl({ url: location.origin }, a.noteId, a.name, "sharp") : null; },
      pdfPages: async (href) => { const a = attachmentLink(href); return a ? pdfPages({ url: location.origin }, a.noteId, a.name) : null; },
      onChange: (md) => { sent.current = md; props.current.onChange(md); },
      onFiles: (files) => props.current.onFiles(files),
      onFile: (href) => {
        const a = attachmentLink(href);
        if (isDrawingLink(href) && a) { props.current.onDrawing(a.name); return; }
        const url = resolveRef.current(href);
        if (url && a) setPdf({ url, name: a.name });
      },
      onImage: (src) => {
        // The pictures the server has (a placeholder isn't one), the clicked one first in view
        const items = ed.gallery().flatMap((g) => { const url = resolveRef.current(g.src); return url ? [{ src: g.src, url, alt: g.alt }] : []; });
        setPictures({ items, index: Math.max(0, items.findIndex((i) => i.src === src)) });
      },
      onLink: (href) => {
        const path = noteLinkPath(href);
        if (path) props.current.onNote(noteIdOf(path));
        return !!path;
      },
      onRead: setReading,
      summarize,
      resolveLink: (url) => qc.fetchQuery(previewQuery(url)),
      placeholder: "Write something…",
    });
    editorRef.current = ed;
    props.current.onEditor(ed);
    return () => { ed.destroy(); editorRef.current = null; props.current.onEditor(null); };
  }, [noteId, qc]);

  // A body that arrives from elsewhere; what the editor itself sent comes back equal, and is left alone
  useEffect(() => {
    if (markdown === sent.current) return;
    sent.current = markdown;
    editorRef.current?.setMarkdown(markdown);
  }, [markdown]);

  useEffect(() => { editorRef.current?.setResolveImage(resolve); }, [resolve]);

  useImperativeHandle(ref, () => ({
    insertMarkdown: (md) => editorRef.current?.insertMarkdown(md),
    focus: (at) => editorRef.current?.focus(at),
  }), []);

  return (
    <>
      <div ref={host} />
      <Lightbox items={pictures.items} index={pictures.index} onIndex={(index) => setPictures((p) => ({ ...p, index }))} />
      <PdfViewer url={pdf?.url ?? null} name={pdf?.name ?? ""} onClose={() => setPdf(null)} />
      <Reader url={reading} onClose={() => setReading(null)} onNote={(id) => { setReading(null); props.current.onNote(id); }} />
    </>
  );
}
