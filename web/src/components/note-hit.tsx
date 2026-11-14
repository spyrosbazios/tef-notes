// A note as a search result: the palette's row (the phone's drawer shows Home's tiles instead). Its picture as a small mosaic, the title, two
// lines of prose (or, for a hit of the assistant's, why it fits), tags and age.
import { Archive, Pin, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { previewOf } from "@/core/agent";
import { ago } from "@/core/time";
import { Mosaic } from "@/components/note-pictures";
import { Peek } from "@/components/peek";
import { TagBadge } from "@/components/tag-badge";
import { useNotePictures } from "@/hooks/thumbs";
import { ms } from "@/lib/search";
import type { NoteRec } from "@/services/notes";

/** A note's pictures as a small mosaic, or nothing when it has none or they fail to load. */
export function Thumb({ n, className }: { n: NoteRec; className: string }) {
  const [ref, pictures, more] = useNotePictures<HTMLSpanElement>(n.note.id, n.note.body);
  return <span ref={ref} className="contents"><Mosaic sources={pictures} more={more} className={className} /></span>;
}

/** `why`: the assistant's reason this note fits, shown for its prose. */
export function NoteHit({ n, now, why }: { n: NoteRec; now: number; why?: string }) {
  const peek = useMemo(() => (why ? "" : previewOf(n.note.body, n.note.title)), [why, n.note.body, n.note.title]);
  return (
    <span className="flex w-full min-w-0 items-start gap-3">
      <Thumb n={n} className="size-14 shrink-0 rounded-md border border-line" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{n.note.title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">{n.note.archived ? <Archive className="mr-1 inline size-3" aria-label="Archived" /> : n.note.pinned ? <Pin className="mr-1 inline size-3" /> : null}{ago(ms(n.updated), now)}</span>
        </span>
        {why ? <span className="line-clamp-2 text-fg text-xs"><Sparkles className="mr-1 inline size-3 text-dim" />{why}</span>
          : peek ? <Peek md={peek} className="line-clamp-2 overflow-hidden text-dim text-xs" /> : <span className="text-dim text-xs">Empty</span>}
        {n.note.tags.length ? <span className="flex flex-wrap gap-1 pt-0.5">{n.note.tags.slice(0, 4).map((t) => <TagBadge key={t} name={t} />)}</span> : null}
      </span>
    </span>
  );
}
