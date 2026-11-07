// A note's tags as badges and an add box that completes from every known name.
// One editor for the open note and for the list's tag dialog, which may hold many notes: `dim` marks the tags only some
// of them carry. It reports a tag added or removed; the caller writes it (applyTags, at the note's rev).
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { fold } from "@/core/notes";
import { TagBadge } from "@/components/tag-badge";
import { useTagNames } from "@/hooks/tag-names";
import { cn } from "@/lib/utils";

export function TagEditor({ tags, dim = [], onAdd, onRemove, onTag }: {
  tags: string[]; dim?: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void; onTag?: (name: string) => void;
}) {
  const names = useTagNames(), list = useId();
  const [adding, setAdding] = useState(false), [v, setV] = useState("");
  const add = () => {
    const t = v.trim().replace(/^#/, "");
    if (t) onAdd(names.find((d) => fold(d) === fold(t)) ?? t);
    setV(""); setAdding(false);
  };
  return (
    <>
      {tags.map((t) => (
        <TagBadge key={t} name={t} onClick={onTag && (() => onTag(t))} onRemove={() => onRemove(t)}
          className={cn("h-6 text-xs", dim.some((d) => fold(d) === fold(t)) && "border-dashed opacity-60")} />
      ))}
      {adding ? (
        <>
          <input autoFocus list={list} value={v} onChange={(e) => setV(e.target.value)} onBlur={add} placeholder="tag"
            onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { setV(""); setAdding(false); } }}
            className="h-6 w-24 rounded-md border border-line bg-card px-2 text-xs outline-none focus:border-brand/60" />
          <datalist id={list}>{names.map((n) => <option key={n} value={n} />)}</datalist>
        </>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-faint hover:bg-muted hover:text-dim">
          <Plus className="size-3" /> tag
        </button>
      )}
    </>
  );
}
