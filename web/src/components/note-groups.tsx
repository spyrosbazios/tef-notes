// The grouped notes list: a header per tag (a note with several tags is under each; "No tag" last) that folds its notes
// away. What goes under a header, laid out, is the caller's, so a note is the same tile, in the same
// grid and with the same selection, in either layout.
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { NO_TAG } from "@/core/note-groups";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTagColor } from "@/hooks/tags";

export function NoteGroup({ tag, count, folded, onToggle, children }: {
  tag: string; count: number; folded: boolean; onToggle: (tag: string) => void; children: ReactNode;
}) {
  const color = useTagColor()(tag);
  const name = tag === NO_TAG ? "No tag" : tag, Chevron = folded ? ChevronRight : ChevronDown;
  return (
    <Collapsible open={!folded} onOpenChange={() => onToggle(tag)} className="space-y-2.5">
      <CollapsibleTrigger aria-label={`${name}, ${count} note${count === 1 ? "" : "s"}`}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        <span data-color={tag === NO_TAG ? "gray" : color} className="size-3 shrink-0 rounded-full border border-tile-fg bg-tile" />
        <span className="min-w-0 flex-1 truncate font-bold text-[15px]">{name}</span>
        <span className="text-xs tabular-nums text-faint">{count}</span>
        <Chevron className="size-4 text-dim" />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
