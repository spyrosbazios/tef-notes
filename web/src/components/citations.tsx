// The agent's sources, drawn under and beside its answer: a chip follows the link that names each one, hover or tap opens
// a preview (the host, the title, the passage), and the list at the end shows every cited source. The answer's links are
// the citations (packages/core/src/citations.ts matches them); this only draws them.
import { ChevronDown } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { citeLink, type Citation } from "@/core/citations";
import { noteIdOf } from "@/core/notes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const CARD_WIDTH = 288;
const GAP = 8;
const CLOSE_MS = 90;

/** A source's mark: the first letter of the host (or of "Note"/"PDF"). */
function Monogram({ cite, className }: { cite: Citation; className?: string }) {
  return (
    <span aria-hidden="true"
      className={cn("flex size-4 shrink-0 items-center justify-center rounded-full bg-raised text-[9px] font-semibold text-dim uppercase", className)}>
      {cite.site.charAt(0)}
    </span>
  );
}

/** A note or PDF opens in the app; a page in a new tab. */
const openSource = (cite: Citation, onNote?: (id: string) => void) => {
  if ((cite.kind === "note" || cite.kind === "pdf") && cite.path && onNote) onNote(noteIdOf(cite.path));
  else if (cite.url) window.open(cite.url, "_blank", "noopener");
  else window.open(citeLink(cite), "_blank", "noopener");
};

/** A source's title and passage, as the chip's preview and a row of the list draw it. */
function SourceBody({ cite, onNote, close }: { cite: Citation; onNote?: (id: string) => void; close?: () => void }) {
  return (
    <div className="rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-dim">
        <Monogram cite={cite} />
        <span className="truncate">{cite.site}</span>
        <span className="ml-auto shrink-0 tabular-nums">{cite.n}</span>
      </div>
      <button type="button" className="mt-1.5 block w-full text-left text-sm font-medium leading-snug text-fg hover:underline"
        onClick={() => { close?.(); openSource(cite, onNote); }}>{cite.title}</button>
      {cite.snippet ? <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-dim">{cite.snippet}</p> : null}
    </div>
  );
}

/** The chip that follows a cited claim: monogram, the host (or "Note"/"PDF") and its number. Hover, focus or tap opens
 *  the preview; Escape, a scroll or a press anywhere else closes it. */
export function SourceChip({ cite, onNote }: { cite: Citation; onNote?: (id: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const clear = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  const hide = useCallback((soon = true) => {
    clear();
    if (soon) timer.current = setTimeout(() => setSpot(null), CLOSE_MS);
    else setSpot(null);
  }, [clear]);
  const show = useCallback(() => {
    clear();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), below = r.top < 200;
    setSpot({ x: Math.min(Math.max(8, r.left + r.width / 2 - CARD_WIDTH / 2), Math.max(8, window.innerWidth - CARD_WIDTH - 8)),
      y: below ? r.bottom + GAP : r.top - GAP, below });
  }, [clear]);

  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!spot) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(false); };
    const onMove = () => hide(false);
    const onDown = (e: PointerEvent) => { if (!(e.target instanceof Element && e.target.closest("[data-cite]"))) hide(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
  }, [spot, hide]);

  return (
    <>
      <button ref={ref} type="button" data-cite="" aria-label={`${cite.site}, source ${cite.n}: ${cite.title}`}
        className={cn("ml-1 inline-flex h-5 -translate-y-px items-center gap-1 rounded-full py-0 pl-0.5 pr-1.5 align-middle text-[11px] font-medium outline-none transition-colors",
          spot ? "bg-fg text-bg" : "bg-raised text-dim hover:text-fg")}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") show(); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
        onFocus={show} onBlur={() => hide(false)}
        onClick={() => (spot ? hide(false) : show())}>
        <Monogram cite={cite} />
        {cite.site}
        <span className="tabular-nums opacity-60">{cite.n}</span>
      </button>
      {createPortal(
        <MotionConfig reducedMotion="user">
          <AnimatePresence>
            {spot ? (
              <motion.div key="preview" role="tooltip" data-cite=""
                className="fixed z-50"
                style={{ left: spot.x, top: spot.y, width: CARD_WIDTH }}
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                onPointerEnter={clear} onPointerLeave={() => hide()}>
                <div className={cn("rounded-xl bg-raised p-1 shadow-lg ring-1 ring-line", !spot.below && "-translate-y-full")}>
                  <SourceBody cite={cite} onNote={onNote} close={() => hide(false)} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </MotionConfig>,
        document.body,
      )}
    </>
  );
}

/** The sources the answer cited: their monograms and count, opening to the numbered list. */
export function Sources({ cited, onNote }: { cited: readonly Citation[]; onNote?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!cited.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs text-dim outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-brand/50">
        <span className="flex -space-x-1">
          {cited.slice(0, 4).map((c) => <Monogram key={c.href} cite={c} className="size-5 ring-2 ring-bg" />)}
        </span>
        {cited.length} source{cited.length === 1 ? "" : "s"}
        <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <ol className="mt-1 space-y-0.5">
          {cited.map((c) => (
            <li key={c.href}>
              <SourceBody cite={c} onNote={onNote} />
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
