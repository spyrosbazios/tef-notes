// A tag as a badge in its definition's colour, painted with the note colours' tokens ([data-color] sets them).
// A tag with no definition, or none with a colour, is gray. Clicking it filters by the tag; with `onRemove` it can
// be taken off the note.
import { X } from "lucide-react";
import { useTagColor } from "@/hooks/tags";
import { cn } from "@/lib/utils";

export function TagBadge({ name, onClick, onRemove, className }: { name: string; onClick?: () => void; onRemove?: () => void; className?: string }) {
  const color = useTagColor()(name);
  const look = cn("inline-flex h-5 items-center rounded-md border border-tile-line/50 bg-tile text-[11px] text-tile-fg", className);
  const label = `#${name}`;
  return (
    <span data-color={color} className={cn(look, onRemove ? "pr-0.5" : "")}>
      {onClick ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={`Notes tagged ${name}`}
          className="h-full rounded-md px-1.5 hover:underline">{label}</button>
      ) : <span className="px-1.5">{label}</span>}
      {onRemove ? (
        <button type="button" aria-label={`Remove tag ${name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="mr-0.5 rounded opacity-60 hover:opacity-100"><X className="size-3" /></button>
      ) : null}
    </span>
  );
}
