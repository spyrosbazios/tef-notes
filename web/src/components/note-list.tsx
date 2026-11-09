// Home's notes: every note as a Keep tile in a masonry read by rows, pinned first then by the chosen sort, a page at a time. Search is the
// palette's (⌘K) and the lens is the filter; a badge clicked anywhere lands here narrowed to its tag (`?tags=`, lib/route-search.ts),
// shown as a chip that clears it. Ctrl/cmd-click or a tile's checkbox selects, shift-click selects a range, and
// the header becomes the bulk bar until Esc. A toggle groups the notes under a header per tag (this browser's choice,
// hooks/note-view.ts), as the phone's Notes tab does: a note with several tags shows under each, and a group folds away.
// Below `md` it is the phone's: two columns, a header of icons (tiles or grouped, sort, +), a tile shows two tags, and
// holding one selects it (the laptop's menu is the bulk bar's then) where a finger on a wider screen opens the menu.
import { ReducedMotionConfig, scale, spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { ArrowDownUp, Check, LayoutGrid, MapPin, Pin, Plus, Sparkles, Tags } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { between, toggled } from "@/core/bulk";
import { groupNotes } from "@/core/note-groups";
import { NOTE_SORT_LABEL, NOTE_SORTS, sortNotes, type NoteSort } from "@/core/note-sort";
import { fold, snippetOf } from "@/core/notes";
import { matchesTags } from "@/core/tags";
import { ago } from "@/core/time";
import { BulkBar, DeleteDialog, TagsDialog, TileMenu } from "@/components/note-actions";
import { NoteGroup } from "@/components/note-groups";
import { Loaded } from "@/components/loaded";
import { Masonry } from "@/components/masonry";
import { TagBadge } from "@/components/tag-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLongPress } from "@/hooks/long-press";
import { useNarrow, useTouch } from "@/hooks/media";
import { useLensSorted, useNotes } from "@/hooks/notes";
import { useNoteView } from "@/hooks/note-view";
import { useNow } from "@/hooks/now";
import { useSavedScroll } from "@/hooks/scroll";
import { useTagNames } from "@/hooks/tag-names";
import { useNotePictures } from "@/hooks/thumbs";
import { Mosaic } from "./note-pictures";
import { arm } from "@/lib/morph";
import { isNotesView, noteLink, useIntent, useNav, type AppLink } from "@/lib/nav";
import { ms } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";

/** The tiles on screen by id. A tile that changes column is a second element with the id while the first one leaves (Masonry's
 *  columns each have their own presence): the shared layout carries it across, so the newcomer does not fade in and the one it
 *  replaces is hidden at once, instead of two tiles fading over each other. */
const onScreen = new Map<string, Set<HTMLElement>>();
function useMoved(id: string, shared: boolean, el: RefObject<HTMLElement | null>): boolean {
  const [moved] = useState(() => shared && onScreen.has(id));
  useLayoutEffect(() => {
    const node = el.current;
    if (!shared || !node) return;
    const others = onScreen.get(id) ?? new Set<HTMLElement>();
    for (const o of others) o.style.visibility = "hidden";
    others.add(node);
    onScreen.set(id, others);
    return () => { others.delete(node); if (!others.size) onScreen.delete(id); };
  }, [id, shared, el]);
  return moved;
}

/** The keys held down on a click or key press: what decides between opening a note and selecting it. */
type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** A note as a Keep tile: its picture across the top, the title, the opening prose, tags, then pin and age. A note with a colour
 *  wears it as the tile's tint. On hover a checkbox selects it and a ⋮ opens its actions (a right-click does too); under a finger
 *  both are always there, and holding the tile opens the same menu. */
export function Tile({ id, n, link, now, selecting = false, selected = false, menuPaths, why, onPick, onCheck, onHold, onTag, onTags, onDelete }: {
  id: string; n: NoteRec; link: AppLink; now: number; selecting?: boolean; selected?: boolean; menuPaths: string[];
  /** The assistant's reason this note fits (search), shown for its prose. */
  why?: string;
  onPick: (e: Modifiers) => void; onTag: (t: string) => void; onTags: () => void; onDelete: () => void;
  /** Selects it: without one the tile has no checkbox, and a hold opens its actions everywhere. */
  onCheck?: () => void;
  /** A hold or right-click, given where, in place of the tile's own menu (search's menu sits at the finger). */
  onHold?: (at: { x: number; y: number }) => void;
}) {
  const snippet = useMemo(() => why || snippetOf(n.note.body, 280), [why, n.note.body]);
  const [ref, pictures, more] = useNotePictures<HTMLDivElement>(n.note.id, n.note.body);
  const [menu, setMenu] = useState(false);
  const phone = useNarrow(), touch = useTouch();
  // A short spring for the tile moving (a reorder, a filter, a new column), a tween for its fade; on a finger it dips to `scale.choice`
  // while held, answering the press before the hold fires
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade), press = useTempoTransition(spring.press);
  const moved = useMoved(id, !phone, ref);
  const hold = useLongPress((at) => (onHold ? onHold(at) : phone && onCheck ? onCheck() : setMenu(true)), { menu: !!onHold || !phone || !onCheck });
  // The note's page and its pictures' list fetched ahead on a hover or a touch, as a link's would be
  const intent = useIntent(() => link);
  const tint = n.note.color;
  // A plain click or Enter opens the note (note-list's `pick`): the tile is what the note's page grows out of (lib/morph.ts)
  const open = (e: Modifiers) => {
    if (!selecting && !e.shiftKey && !e.ctrlKey && !e.metaKey && ref.current) arm(n.note.id, ref.current);
    onPick(e);
  };
  const chrome = cn("absolute top-2 z-10 flex size-6 items-center justify-center rounded-md border border-line bg-card/90 text-dim shadow-sm backdrop-blur hover:text-fg",
    "hit opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 any-pointer-coarse:md:opacity-100", menu && "opacity-100");
  return (
    <ReducedMotionConfig>
    <motion.div ref={ref} role="button" layout="position" layoutId={phone ? undefined : id} initial={moved ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      whileTap={touch ? { scale: scale.choice } : undefined} exit={{ opacity: 0, scale: 0.96, transition: fade }} transition={{ ...move, opacity: fade, scale: press }} tabIndex={0} onClick={open} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
      {...hold} {...intent}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(e); } }}
      aria-selected={selecting ? selected : undefined} data-color={tint}
      className={cn("group relative w-full cursor-pointer overflow-hidden rounded-2xl border text-left transition-colors any-pointer-coarse:select-none",
        tint ? "bg-tile text-tile-fg" : "bg-card hover:bg-raised",
        selected ? "border-brand ring-2 ring-brand" : tint ? "border-tile-line/50" : "border-line")}>
      {/* Not ui/checkbox or TickBox: this is a chip on the tile's corner (shown on hover, over a picture), not a form control or a task's tick */}
      {onCheck ? <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${n.note.title}`} onClick={(e) => { e.stopPropagation(); onCheck(); }}
        className={cn(chrome, "left-2", selecting && "opacity-100", selected && "border-brand bg-brand text-bg hover:text-bg")}>
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </button> : null}
      {onHold ? null : <TileMenu paths={menuPaths} open={menu} onOpenChange={setMenu} onTags={onTags} onDelete={onDelete} className={cn(chrome, "right-2 max-md:hidden")} />}
      <Mosaic sources={pictures} more={more} className={pictures.length > 2 ? "h-44" : "h-32"} />
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 font-semibold text-[15px] leading-snug">{n.note.title}</h3>
        {snippet ? <p className={cn("line-clamp-6 text-[13px] leading-snug", why ? "" : tint ? "opacity-85" : "text-dim")}>{why ? <Sparkles className="mr-1 inline size-3 opacity-70" /> : null}{snippet}</p> : null}
        {n.note.tags.length ? (
          <span className="flex flex-wrap gap-1 max-md:[&>*:nth-child(n+3)]:hidden">
            {n.note.tags.map((t) => <TagBadge key={t} name={t} onClick={() => onTag(t)} />)}
          </span>
        ) : null}
        <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums", tint ? "text-tile-line" : "text-faint")}>
          {n.note.pinned ? <Pin className="size-3" /> : null}
          <span className="shrink-0">{ago(ms(n.updated), now)}</span>
          {n.note.where ? <span className="inline-flex min-w-0 items-center gap-0.5"><MapPin className="size-3 shrink-0" /><span className="truncate">{n.note.where.name}</span></span> : null}
        </span>
      </div>
    </motion.div>
    </ReducedMotionConfig>
  );
}

/** A tile's shape while the notes load: some with a picture, titles and prose of varied length, so the masonry looks like itself. */
const SHAPES = [
  { pic: true, title: 3 / 4, lines: 2, tags: 1 }, { pic: false, title: 1 / 2, lines: 5, tags: 2 }, { pic: false, title: 2 / 3, lines: 3, tags: 0 },
  { pic: true, title: 5 / 6, lines: 0, tags: 1 }, { pic: false, title: 3 / 5, lines: 6, tags: 1 }, { pic: false, title: 4 / 5, lines: 2, tags: 2 },
  { pic: true, title: 1 / 2, lines: 3, tags: 0 }, { pic: false, title: 2 / 3, lines: 4, tags: 1 },
];

function SkeletonTile({ shape }: { shape: (typeof SHAPES)[number] }) {
  return (
    <div aria-hidden className="w-full overflow-hidden rounded-2xl border border-line bg-card">
      {shape.pic ? <Skeleton className="h-32 rounded-none" /> : null}
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4" style={{ width: `${shape.title * 100}%` }} />
        {Array.from({ length: shape.lines }, (_, i) => <Skeleton key={i} className="h-3" style={{ width: i === shape.lines - 1 ? "60%" : "100%" }} />)}
        {shape.tags ? <span className="flex gap-1">{Array.from({ length: shape.tags }, (_, i) => <Skeleton key={i} className="h-4 w-12 rounded-full" />)}</span> : null}
        <Skeleton className="h-2.5 w-10" />
      </div>
    </div>
  );
}

const PAGE = 30;

/** The tiles to draw at first: a page, and more when the router is about to put the page back further down than one reaches
 *  (a page of tiles is a screen or more, so a page per 1000px over-reaches rather than leaves the place past the end). */
const startLimit = (y: number) => PAGE * (1 + Math.ceil(Math.max(0, y) / 1000));

/** What Home's sort reads off a note record. */
const recSortable = (n: NoteRec) => ({ pinned: n.note.pinned, updated: n.updated, created: n.note.created, path: n.path });

/** The phone's header controls (Home's task box and its notes): one 40px outlined rounded square each, an icon of 20px, `gap-2` between. A
 *  wider control keeps the height and the corners. */
export const TOOL = "max-md:h-10 max-md:min-w-10 max-md:rounded-xl";

/** `scrollId`: its page's scroller (Home's or the Notes page's), whose place is put back: by the router for a badge's tag, by `useScrollSwitch` for a lens (lib/scroll.ts). */
export function NoteList({ onNew, scrollId }: { onNew: () => void; scrollId: string }) {
  const { isPending } = useNotes();
  const { view, openNote, filterTag, setTags } = useNav();
  const chips = useMemo(() => (isNotesView(view) ? view.tags ?? [] : []), [view]);
  const place = useSavedScroll(scrollId);
  const [limit, setLimit] = useState(() => startLimit(place));
  const end = useRef<HTMLDivElement>(null);
  const base = useLensSorted();
  const { grouped, collapsed, sort, setGrouped, fold: foldGroup, setSort } = useNoteView();
  const narrow = useNarrow();
  const sorted = useMemo(() => sortNotes(base, sort, recSortable), [base, sort]);
  const now = useNow(30_000);
  const names = useTagNames();
  const [sel, setSel] = useState<string[]>([]);                   // selected paths
  const [dialog, setDialog] = useState<"tags" | "delete" | null>(null);   // open, over `target`
  const [target, setTarget] = useState<string[]>([]);            // what it acts on, kept through its closing
  const anchor = useRef<string | undefined>(undefined);
  const shown = useMemo(() => sorted.filter((n) => matchesTags(n.note.tags, chips, true)), [sorted, chips]);
  const order = useMemo(() => shown.map((n) => n.path), [shown]);
  const groups = useMemo(     // the core groups anything with `tags`: a record's are its note's
    () => (grouped ? groupNotes(shown.map((rec) => ({ tags: rec.note.tags, rec })), names).map((g) => ({ tag: g.tag, notes: g.notes.map((x) => x.rec) })) : []),
    [grouped, shown, names]);
  const folded = (tag: string) => collapsed.some((c) => fold(c) === fold(tag));
  // What a shift-click's range runs over: the notes as they stand on screen, a folded group's left out, a note under two tags once.
  const sights = () => (grouped ? [...new Set(groups.filter((g) => !folded(g.tag)).flatMap((g) => g.notes.map((n) => n.path)))] : order);

  // A selection belongs to the list it was made in: another view, filter or lens starts over, with the tiles to reach the place that
  // list was left at drawn (the page is put back to it as the list changes)
  const scope = `${scrollId} ${sort}`;
  const [seen, setSeen] = useState(scope);
  if (seen !== scope) { setSeen(scope); setSel([]); setLimit(startLimit(place)); }
  const picked = useMemo(() => sel.filter((p) => order.includes(p)), [sel, order]);
  const selecting = picked.length > 0;

  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) setSel([]);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [selecting]);

  const more = !grouped && shown.length > limit;
  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setLimit((n) => n + PAGE); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);

  const pick = (path: string, e: Modifiers) => {
    if (e.shiftKey) setSel([...new Set([...picked, ...between(sights(), anchor.current, path)])]);
    else if (e.ctrlKey || e.metaKey || selecting) setSel(toggled(picked, path));
    else { const id = idOf(path); if (id) openNote(id); return; }
    anchor.current = path;
  };
  const idOf = (path: string) => shown.find((x) => x.path === path)?.note.id ?? null;
  const ask = (kind: "tags" | "delete", paths: string[]) => { setTarget(paths); setDialog(kind); };
  const check = (path: string) => { setSel(toggled(picked, path)); anchor.current = path; };

  const tile = (t: NoteRec, key: string) => {
    const on = picked.includes(t.path), menuPaths = on ? picked : [t.path];
    return (
      <Tile key={key} id={key} n={t} link={noteLink(t.note.id, { view })} now={now} selecting={selecting} selected={on} menuPaths={menuPaths}
        onPick={(e) => pick(t.path, e)} onCheck={() => check(t.path)} onTag={filterTag}
        onTags={() => ask("tags", menuPaths)} onDelete={() => ask("delete", menuPaths)} />
    );
  };

  return (
    <section className="flex flex-col max-md:px-4" aria-label="Notes">
      {/* Stays at the top of the scroller, so the bulk bar it turns into is in view when a tile far down is selected */}
      <header className="sticky top-0 z-20 -mt-2 bg-bg pt-2 pb-3 max-md:-mx-4 max-md:px-4">
        {selecting ? (
          <BulkBar paths={picked} onClear={() => setSel([])} onAll={() => setSel(order)}
            onTags={() => ask("tags", picked)} onDelete={() => ask("delete", picked)} />
        ) : (
          <div className="flex min-h-8 flex-wrap items-center gap-2 max-md:min-h-10">
            {/* The title and its count sit on one baseline, the controls centred beside them (the wrapper only exists on a phone) */}
            <div className="max-md:mr-auto max-md:flex max-md:items-baseline max-md:gap-2 md:contents">
              <h2 className="font-bold text-[22px] tracking-tight max-md:text-lg max-md:font-extrabold">Notes</h2>
              <span className={cn("text-xs tabular-nums text-faint md:self-baseline md:pt-1", !chips.length && "md:mr-auto")}>{shown.length}</span>
              {/* The tag filter reads as what it is, the tags themselves beside the count, each taken off on its own */}
              {chips.length ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 self-center md:mr-auto md:ml-2">
                  {chips.map((t) => <TagBadge key={t} name={t} className="h-6 text-xs" onRemove={() => setTags(chips.filter((c) => c !== t))} />)}
                </div>
              ) : null}
            </div>
            {narrow ? (
              // The phone's toggle: one button showing the other layout (the animated group's gliding highlight has
              // nothing to sit on when the selected item is hidden, and paints a stray surface)
              <Button variant="outline" size="icon-sm" className={cn("text-dim", TOOL)} aria-pressed={grouped}
                aria-label={grouped ? "Show notes as tiles" : "Group notes by tag"} onClick={() => setGrouped(!grouped)}>
                {grouped ? <LayoutGrid className="size-5" /> : <Tags className="size-5" />}
              </Button>
            ) : (
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={grouped ? "tags" : "list"} aria-label="Layout"
                onValueChange={(v) => { if (v) setGrouped(v === "tags"); }}>
                <ToggleGroupItem value="list" aria-label="Show notes as tiles" title="Tiles" className="text-dim"><LayoutGrid /></ToggleGroupItem>
                <ToggleGroupItem value="tags" aria-label="Group notes by tag" title="Group by tag" className="text-dim"><Tags /></ToggleGroupItem>
              </ToggleGroup>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as NoteSort)}>
              <SelectTrigger size="sm" aria-label="Sort notes"
                className="text-dim max-md:w-10 max-md:min-w-10 max-md:justify-center max-md:p-0 max-md:data-[size=sm]:h-10 max-md:data-[size=sm]:rounded-xl max-md:[&_[data-slot=select-value]]:hidden max-md:[&>svg:last-child]:hidden">
                <ArrowDownUp className="max-md:size-5" /><SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {NOTE_SORTS.map((k) => <SelectItem key={k} value={k}>{NOTE_SORT_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant={narrow ? "outline" : "default"} className={cn("rounded-full", TOOL, "max-md:px-0 max-md:text-brand max-md:hover:text-brand")} aria-label="New note" onClick={onNew}>
              <Plus className="max-md:size-5" /><span className="max-md:hidden">New note</span>
            </Button>
          </div>
        )}
      </header>
      <div className={cn(selecting && "select-none")} aria-busy={isPending || undefined}>
        {/* Home's tiles are too large a surface to blur: the content fades in alone */}
        <Loaded loading={isPending} blurred={false} skeleton={<Masonry>{SHAPES.map((s, i) => <SkeletonTile key={i} shape={s} />)}</Masonry>}>
          {shown.length ? (
            <div className={cn(grouped && "space-y-4")}>
              {grouped
                ? groups.map((g) => (
                  <NoteGroup key={g.tag} tag={g.tag} count={g.notes.length} folded={folded(g.tag)} onToggle={foldGroup}>
                    <Masonry animate>{g.notes.map((t) => tile(t, `${g.tag}:${t.path}`))}</Masonry>
                  </NoteGroup>
                ))
                : <Masonry animate>{shown.slice(0, limit).map((t) => tile(t, t.path))}</Masonry>}
            </div>
          ) : <p className="px-3 py-10 text-center text-sm text-faint">{chips.length ? "No note has every tag ticked." : "No notes here yet."}</p>}
        </Loaded>
      </div>
      {more ? <div ref={end} className="h-px" aria-hidden /> : null}
      <TagsDialog paths={target} open={dialog === "tags"} onOpenChange={(o) => { if (!o) setDialog(null); }} />
      <DeleteDialog paths={target} open={dialog === "delete"} onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={() => { setDialog(null); setSel([]); }} />
    </section>
  );
}
