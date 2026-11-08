// Home's notes: every note as a Keep tile in a masonry read by rows, pinned first then by the chosen sort, a page at a time. Search is the
// palette's (⌘K); here a multiselect narrows to notes carrying every chosen tag, kept in the URL (`?tags=`, lib/route-search.ts) so a
// badge clicked anywhere lands here filtered. Ctrl/cmd-click or a tile's checkbox selects, shift-click selects a range, and
// the header becomes the bulk bar until Esc. A toggle groups the notes under a header per tag (this browser's choice,
// hooks/note-view.ts), as the phone's Notes tab does: a note with several tags shows under each, and a group folds away.
// Below `md` it is the phone's: two columns, a header of icons (tag filter, tiles or grouped, sort, +), a tile shows two tags, and
// holding one selects it (the laptop's menu is the bulk bar's then) where a finger on a wider screen opens the menu.
import { scale, spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { ArrowDownUp, Check, Hash, LayoutGrid, Pin, Plus, Tags, X } from "lucide-react";
import { useElementScrollRestoration } from "@tanstack/react-router";
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
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLongPress } from "@/hooks/long-press";
import { useNarrow, useTouch } from "@/hooks/media";
import { useLensSorted, useNotes } from "@/hooks/notes";
import { useNoteView } from "@/hooks/note-view";
import { useNow } from "@/hooks/now";
import { useTagNames } from "@/hooks/tag-names";
import { useNotePictures } from "@/hooks/thumbs";
import { Mosaic } from "./note-pictures";
import { noteLink, useIntent, useNav, type AppLink } from "@/lib/nav";
import { SCROLL_KEY } from "@/lib/scroll";
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
function Tile({ id, n, link, now, selecting, selected, menuPaths, onPick, onCheck, onTag, onTags, onDelete }: {
  id: string; n: NoteRec; link: AppLink; now: number; selecting: boolean; selected: boolean; menuPaths: string[];
  onPick: (e: Modifiers) => void; onCheck: () => void; onTag: (t: string) => void; onTags: () => void; onDelete: () => void;
}) {
  const snippet = useMemo(() => snippetOf(n.note.body, 280), [n.note.body]);
  const [ref, pictures, more] = useNotePictures<HTMLDivElement>(n.note.id, n.note.body);
  const [menu, setMenu] = useState(false);
  const phone = useNarrow(), touch = useTouch();
  // A short spring for the tile moving (a reorder, a filter, a new column), a tween for its fade; on a finger it dips to `scale.choice`
  // while held, answering the press before the hold fires
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade), press = useTempoTransition(spring.press);
  const moved = useMoved(id, !phone, ref);
  const hold = useLongPress(() => (phone ? onCheck() : setMenu(true)), { menu: !phone });
  // The note's page and its pictures' list fetched ahead on a hover or a touch, as a link's would be
  const intent = useIntent(() => link);
  const tint = n.note.color;
  const chrome = cn("absolute top-2 z-10 flex size-6 items-center justify-center rounded-md border border-line bg-card/90 text-dim shadow-sm backdrop-blur hover:text-fg",
    "hit opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 any-pointer-coarse:md:opacity-100", menu && "opacity-100");
  return (
    <motion.div ref={ref} role="button" layout="position" layoutId={phone ? undefined : id} initial={moved ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      whileTap={touch ? { scale: scale.choice } : undefined} exit={{ opacity: 0, scale: 0.96, transition: fade }} transition={{ ...move, opacity: fade, scale: press }} tabIndex={0} onClick={onPick} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
      {...hold} {...intent}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(e); } }}
      aria-selected={selecting ? selected : undefined} data-color={tint}
      className={cn("group relative w-full cursor-pointer overflow-hidden rounded-2xl border text-left transition-colors any-pointer-coarse:select-none",
        tint ? "bg-tile text-tile-fg" : "bg-card hover:bg-raised",
        selected ? "border-brand ring-2 ring-brand" : tint ? "border-tile-line/50" : "border-line")}>
      {/* Not ui/checkbox or TickBox: this is a chip on the tile's corner (shown on hover, over a picture), not a form control or a task's tick */}
      <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${n.note.title}`} onClick={(e) => { e.stopPropagation(); onCheck(); }}
        className={cn(chrome, "left-2", selecting && "opacity-100", selected && "border-brand bg-brand text-bg hover:text-bg")}>
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </button>
      <TileMenu paths={menuPaths} open={menu} onOpenChange={setMenu} onTags={onTags} onDelete={onDelete} className={cn(chrome, "right-2 max-md:hidden")} />
      <Mosaic sources={pictures} more={more} className={pictures.length > 2 ? "h-44" : "h-32"} />
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 font-semibold text-[15px] leading-snug">{n.note.title}</h3>
        {snippet ? <p className={cn("line-clamp-6 text-[13px] leading-snug", tint ? "opacity-85" : "text-dim")}>{snippet}</p> : null}
        {n.note.tags.length ? (
          <span className="flex flex-wrap gap-1 max-md:[&>*:nth-child(n+3)]:hidden">
            {n.note.tags.map((t) => <TagBadge key={t} name={t} onClick={() => onTag(t)} />)}
          </span>
        ) : null}
        <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums", tint ? "text-tile-line" : "text-faint")}>
          {n.note.pinned ? <Pin className="size-3" /> : null}
          {ago(ms(n.updated), now)}
        </span>
      </div>
    </motion.div>
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

/** The phone's header controls (Home's task box and its notes): one 40px outlined rounded square each, an icon of 20px, `gap-2` between. Where a
 *  control is wider (the tag filter naming what it has chosen) it keeps the height and the corners. */
export const TOOL = "max-md:h-10 max-md:min-w-10 max-md:rounded-xl";

/** The tag filter: a button naming what is chosen, opening every tag in the list (with its count) to tick on or off. Home's tasks use it
 *  too (`what`). The "Tags" word folds into the icon when none is chosen: on a phone, and under 20rem when a `@container` holds it (Home's
 *  task box, where the three list names and this would collide). */
export function TagFilter({ counts, chosen, onChange, what = "Notes" }: { counts: [string, number][]; chosen: string[]; onChange: (tags: string[]) => void; what?: string }) {
  const on = (t: string) => chosen.some((c) => fold(c) === fold(t));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Filter by tag"
          className={cn("max-w-64 max-sm:max-w-28", TOOL, chosen.length ? "text-fg max-md:px-3" : "text-dim max-sm:px-0 max-md:px-3")}>
          <Hash className="max-md:size-5" /><span className={cn("truncate", !chosen.length && "max-sm:hidden @max-xs:hidden")}>{chosen.length ? chosen.join(", ") : "Tags"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>{what} with every tag ticked</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {counts.length ? counts.map(([t, c]) => (
          <DropdownMenuCheckboxItem key={t} checked={on(t)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => onChange(v ? [...chosen, t] : chosen.filter((x) => fold(x) !== fold(t)))}>
            <span className="flex-1 truncate">{t}</span><span className="text-xs tabular-nums text-faint">{c}</span>
          </DropdownMenuCheckboxItem>
        )) : <p className="px-2 py-1.5 text-sm text-faint">No tags yet.</p>}
        {chosen.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}><X /> Clear</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** `scrollId`: Home's scroller, whose place the router is putting back (lib/scroll.ts). */
export function NoteList({ onNew, scrollId }: { onNew: () => void; scrollId: string }) {
  const { isPending } = useNotes();
  const { view, openNote, filterTag, setTags } = useNav();
  const chips = useMemo(() => (view.kind === "home" ? view.tags ?? [] : []), [view]);
  const back = useElementScrollRestoration({ id: scrollId, getKey: () => SCROLL_KEY });
  const [limit, setLimit] = useState(() => startLimit(back?.scrollY ?? 0));
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
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of base) for (const t of n.note.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [base]);
  const groups = useMemo(     // the core groups anything with `tags`: a record's are its note's
    () => (grouped ? groupNotes(shown.map((rec) => ({ tags: rec.note.tags, rec })), names).map((g) => ({ tag: g.tag, notes: g.notes.map((x) => x.rec) })) : []),
    [grouped, shown, names]);
  const folded = (tag: string) => collapsed.some((c) => fold(c) === fold(tag));
  // What a shift-click's range runs over: the notes as they stand on screen, a folded group's left out, a note under two tags once.
  const sights = () => (grouped ? [...new Set(groups.filter((g) => !folded(g.tag)).flatMap((g) => g.notes.map((n) => n.path)))] : order);

  // A selection belongs to the list it was made in: another view or filter starts over.
  const scope = `${chips.join(",")} ${sort}`;
  const [seen, setSeen] = useState(scope);
  if (seen !== scope) { setSeen(scope); setSel([]); setLimit(PAGE); }
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
      <header className="pb-3">
        {selecting ? (
          <BulkBar paths={picked} onClear={() => setSel([])} onAll={() => setSel(order)}
            onTags={() => ask("tags", picked)} onDelete={() => ask("delete", picked)} />
        ) : (
          <div className="flex min-h-8 flex-wrap items-center gap-2 max-md:min-h-10">
            {/* The title and its count sit on one baseline, the controls centred beside them (the wrapper only exists on a phone) */}
            <div className="max-md:mr-auto max-md:flex max-md:items-baseline max-md:gap-2 md:contents">
              <h2 className="font-bold text-[22px] tracking-tight max-md:text-lg max-md:font-extrabold">Notes</h2>
              <span className="text-xs tabular-nums text-faint md:mr-auto md:self-baseline md:pt-1">{shown.length}</span>
            </div>
            <TagFilter counts={counts} chosen={chips} onChange={setTags} />
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
