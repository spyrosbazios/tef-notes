// Markdown read, not edited (Reader view, a task's notes, a confirm card): GitHub-flavoured, a typed line break kept (as on
// the phone), checkboxes shown as they are (a note's own are ticked in its editor). A photo opens in the lightbox, a PDF chip
// in the PDF viewer, a drawing chip as its picture.
import type { Element, Root, RootContent } from "hast";
import { ImageOff } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { findCite, type Citation } from "@/core/citations";
import { noteLinkPath } from "@/core/links";
import { noteIdOf } from "@/core/notes";
import { SourceChip } from "@/components/citations";
import { Lightbox, type LightboxItem } from "@/components/lightbox";
import { PdfViewer } from "@/components/pdf-viewer";
import { attachmentLink, drawingPreview, isDrawing, isPdf } from "@/core/photos";
import { cn } from "@/lib/utils";

/** Task checkboxes drawn in full colour: remark-gfm draws them disabled, greyed. They stay read-only. */
function plainBoxes() {
  return (tree: Root) => {
    const walk = (n: Root | RootContent) => {
      if (n.type === "element") {
        const e = n as Element;
        if (e.tagName === "input" && e.properties.type === "checkbox") delete e.properties.disabled;
      }
      if ("children" in n) n.children.forEach(walk);
    };
    walk(tree);
  };
}

type Props = {
  body: string;
  className?: string;
  onNote?: (id: string) => void;
  /** The sources an agent answer cited: a link that names one draws its citation chip. */
  cites?: readonly Citation[];
};

export const Markdown = memo(function Markdown({ body, className, onNote, cites }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [pictures, setPictures] = useState<{ items: LightboxItem[]; index: number | null }>({ items: [], index: null });
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);

  /** The photos on the page (a placeholder isn't one), `img` the one in view. */
  const look = (img: HTMLImageElement) => {
    const all = [...(root.current?.querySelectorAll("img") ?? [])];
    setPictures({ items: all.map((i) => ({ url: i.currentSrc || i.src, alt: i.alt })), index: Math.max(0, all.indexOf(img)) });
  };

  return (
    <div ref={root} className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[plainBoxes]}
        components={{
          input: (p) => (p.type === "checkbox" ? <input type="checkbox" checked={!!p.checked} readOnly onClick={(e) => e.stopPropagation()} /> : null),
          a: ({ href = "", title, children }) => {
            // The link that names a source the agent read this turn: the chip follows it (packages/core/src/citations.ts)
            const cite = cites?.length ? findCite(href, cites) : undefined;
            const withCite = (node: ReactNode) => (cite ? <>{node}<SourceChip cite={cite} onNote={onNote} /></> : node);
            // A PDF of this note's: a chip, opening in a new tab once the page has its URL (see useShown), plain until then
            const file = attachmentLink(href);
            if (file && (isPdf(file.name) || isDrawing(file.name))) {
              const drawing = isDrawing(file.name), shown = /^https?:/.test(href);
              return withCite(shown
                ? <a className={cn("file-chip", drawing && "drawing-chip")} href={href} title={title}
                    onClick={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (drawing) setPictures({ items: [{ url: drawingPreview(href), alt: file.name }], index: 0 });
                      else setPdf({ url: href, name: file.name });
                    }}>{children}</a>
                : <span className={cn("file-chip", drawing && "drawing-chip")} title="Not on the server yet">{children}</span>);
            }
            const note = noteLinkPath(href);
            return withCite(note ? (
              <a href={`/note/${encodeURIComponent(noteIdOf(note))}`} title={title} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNote?.(noteIdOf(note)); }}>{children}</a>
            ) : <a href={href} title={title} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{children}</a>);
          },
          img: ({ src, alt }) =>
            // A photo of this note's that the server doesn't list (yet) still reads `attachments/…`: a placeholder, not a broken image
            typeof src === "string" && !/^(\.\.?\/|\/)?attachments\//.test(src) ? (
              <img src={src} alt={alt ?? ""} loading="lazy" className="cursor-zoom-in" onClick={(e) => { e.stopPropagation(); look(e.currentTarget); }} />
            ) : (
              <span className="inline-flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-6 text-faint text-xs">
                <ImageOff className="size-4" /> {alt || "photo"}
              </span>
            ),
        }}
      >
        {body}
      </ReactMarkdown>
      <Lightbox items={pictures.items} index={pictures.index} onIndex={(index) => setPictures((p) => ({ ...p, index }))} />
      <PdfViewer url={pdf?.url ?? null} name={pdf?.name ?? ""} onClose={() => setPdf(null)} />
    </div>
  );
});
