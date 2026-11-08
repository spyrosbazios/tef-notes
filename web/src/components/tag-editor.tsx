// A note's tags as badges and an add box that completes from every known name.
// One editor for the open note and for the list's tag dialog, which may hold many notes: `dim` marks the tags only some
// of them carry. It reports a tag added or removed; the caller writes it (applyTags, at the note's rev). At phone width the add
// button opens a sheet instead of an inline box: the tags in use as switches and a field for a new one, as the phone's picker is.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { Check, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { fold } from "@/core/notes";
import { Pick } from "@/components/pick";
import { TagBadge } from "@/components/tag-badge";
import { useNarrow } from "@/hooks/media";
import { useLeaving } from "@/hooks/presence";
import { useTagNames } from "@/hooks/tag-names";
import { cn } from "@/lib/utils";

/** The tags in the sheet: every known name as a switch (on: the item has it), and a field to make a new one. */
function TagSheet({ names, tags, onAdd, onRemove }: { names: string[]; tags: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void }) {
  const [v, setV] = useState("");
  const typed = v.trim().replace(/^#/, ""), f = fold(typed);
  const known = names.filter((n) => !f || fold(n).includes(f));
  const has = (n: string) => tags.some((t) => fold(t) === fold(n));
  const fresh = typed && !names.some((n) => fold(n) === f) && !has(typed);
  const add = () => { if (!typed) return; onAdd(names.find((n) => fold(n) === f) ?? typed); setV(""); };
  return (
    <div className="space-y-3">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Find or make a tag" aria-label="Tag" enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base outline-none focus:border-brand/60" />
      <div className="flex flex-wrap gap-2">
        {fresh ? <button type="button" onClick={add} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-brand px-3 text-sm text-brand"><Plus className="size-3.5" />Make “{typed}”</button> : null}
        {known.map((n) => (
          <button key={n} type="button" aria-pressed={has(n)} onClick={() => (has(n) ? onRemove(tags.find((t) => fold(t) === fold(n)) ?? n) : onAdd(n))}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm", has(n) ? "border-brand bg-brand/10 text-brand" : "border-line text-dim")}>
            {has(n) ? <Check className="size-3.5" /> : null}{n}
          </button>
        ))}
        {!known.length && !fresh ? <p className="text-sm text-faint">No tags yet. Type a name to make one.</p> : null}
      </div>
    </div>
  );
}

/** A tag popping in from half its size with a fade, shrinking out when taken off (and then out of the tab order, its focus handed on). */
function Chip({ children }: { children: ReactNode }) {
  const ref = useLeaving<HTMLSpanElement>();
  const pop = useTempoTransition(spring.pop), reflow = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade), out = useTempoTransition(transition.popOut);
  const half = { opacity: 0, scale: 0.5 };
  return (
    <motion.span ref={ref} layout="position" className="inline-flex" initial={half} animate={{ opacity: 1, scale: 1, transition: { ...pop, opacity: fade } }}
      exit={{ ...half, transition: out }} transition={{ layout: reflow }}>
      {children}
    </motion.span>
  );
}

export function TagEditor({ tags, dim = [], onAdd, onRemove, onTag }: {
  tags: string[]; dim?: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void; onTag?: (name: string) => void;
}) {
  const names = useTagNames(), list = useId();
  const [adding, setAdding] = useState(false), [v, setV] = useState("");
  const narrow = useNarrow();
  const reflow = useTempoTransition(spring.reflow);
  const add = () => {
    const t = v.trim().replace(/^#/, "");
    if (t) onAdd(names.find((d) => fold(d) === fold(t)) ?? t);
    setV(""); setAdding(false);
  };
  // A tag added pops in, one taken off shrinks out, and the others (and the add button) close the gap
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        {tags.map((t) => (
          <Chip key={t}>
            <TagBadge name={t} onClick={onTag && (() => onTag(t))} onRemove={() => onRemove(t)}
              className={cn("h-6 text-xs", dim.some((d) => fold(d) === fold(t)) && "border-dashed opacity-60")} />
          </Chip>
        ))}
      </AnimatePresence>
      <motion.span layout="position" className="inline-flex items-center" transition={{ layout: reflow }}>
      {narrow ? (
        <Pick title="Tags" trigger={<button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-faint hover:bg-muted hover:text-dim"><Plus className="size-3" /> tag</button>}>
          <TagSheet names={names} tags={tags} onAdd={onAdd} onRemove={onRemove} />
        </Pick>
      ) : adding ? (
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
      </motion.span>
    </>
  );
}
