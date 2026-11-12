// Search on a phone: Home's drawer, opened by the header's search button, its results
// in place of the page. One field; under it the notes it finds, the tasks, tags and the screens to jump to. A finished `#tag`
// becomes a chip in the field (absorbed as it is typed, taken off with its x or Backspace) and narrows notes and tasks alike;
// a tag still being typed is a prefix, and the Tags rows offer the names (tap: a chip). Everything is inside the lens that is on.
// Notes are Home's tiles in its masonry, gliding as results change; a long press on one opens its actions. When words find no note or task, "Search with the assistant" asks the agent for what
// was meant (core/find.ts; the palette's too, hooks/search.ts), its hits filling the list with why each fits. The palette (⌘K)
// is the laptop's; this is the phone's, for the same data. It comes down from under the header as a sheet from the top edge
// (Animate UI's sheet recipe: in on transition.sheet, away on transition.dismiss, a fade in place under reduced motion), over the
// page, which stays laid out under it; the results inside are never staggered (they change on every key): they glide and fade as they change, notes as Home's tiles.
import { ReducedMotionConfig, spring, transition, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ShimmeringText } from "@animate-ui/react/primitives/texts/shimmering";
import { MicButton } from "@/components/mic-button";
import { Archive, AudioLines, CalendarDays, Check, Hash, Inbox, ListTodo, Loader2, Search, SearchX, Settings, Sparkles, Star, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { absorbTags, dropTyping } from "@/core/tags";
import { fold } from "@/core/notes";
import { MenuAt, TagsDialog, DeleteDialog } from "@/components/note-actions";
import { Masonry } from "@/components/masonry";
import { Tile } from "@/components/note-list";
import { TagBadge } from "@/components/tag-badge";
import { useAssistant } from "@/hooks/assistant";
import { useActiveLens } from "@/hooks/lens";
import { useNow } from "@/hooks/now";
import { useLeaving } from "@/hooks/presence";
import { useFinder } from "@/hooks/search";
import { useTalkOn } from "@/hooks/talk";
import { homeOfTask, noteLink, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

const VIEWS: { label: string; icon: LucideIcon; view: View | "ask" }[] = [
  { label: "Inbox", icon: Inbox, view: { kind: "inbox" } }, { label: "Today", icon: Star, view: { kind: "today" } },
  { label: "Upcoming", icon: CalendarDays, view: { kind: "upcoming" } }, { label: "Logbook", icon: Archive, view: { kind: "logbook" } },
  { label: "Ask the assistant", icon: Sparkles, view: "ask" }, { label: "Talk", icon: AudioLines, view: { kind: "talk" } }, { label: "Settings", icon: Settings, view: { kind: "settings" } },
];

const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors active:bg-muted disabled:opacity-60";

/** A group of results: it slides into place as the groups above it grow or go, and fades in and out as it comes and goes. */
function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade);
  return (
    <motion.section layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: fade }}
      transition={{ ...move, opacity: fade }} className="pt-4">
      <h3 className="flex items-baseline gap-2 px-3 pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
        {title}{count ? <span className="tabular-nums font-medium normal-case">{count}</span> : null}
      </h3>
      {children}
    </motion.section>
  );
}

/** A row in a group, gliding and fading as the results change like the tiles do. */
function Row({ children }: { children: ReactNode }) {
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade);
  return (
    <motion.div layout="position" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: fade }}
      transition={{ ...move, opacity: fade, scale: fade }}>
      {children}
    </motion.div>
  );
}

/** Notes as Home's tiles, in its masonry: a tile glides as the results reflow and fades in or out as they change. Keys are
 *  prefixed so a tile here never shares a layout id with the Notes page's own. */
function Tiles({ notes, now, onOpen, onMenu, onTag, onTags, onDelete }: {
  notes: { n: NoteRec; why?: string }[]; now: number; onOpen: (n: NoteRec) => void;
  onMenu: (path: string) => (at: { x: number; y: number }) => void; onTag: (t: string) => void; onTags: (path: string) => void; onDelete: (path: string) => void;
}) {
  return (
    <Masonry animate className="px-1 pt-1">
      {notes.map(({ n, why }) => (
        <Tile key={`search:${n.path}`} id={`search:${n.path}`} n={n} why={why} link={noteLink(n.note.id, null)} now={now} menuPaths={[n.path]}
          onPick={() => onOpen(n)} onHold={onMenu(n.path)} onTag={onTag} onTags={() => onTags(n.path)} onDelete={() => onDelete(n.path)} />
      ))}
    </Masonry>
  );
}

/** `header`: Home's top row, kept above the field; `onClose` puts the page back. Rendered under an `AnimatePresence` (home.tsx,
 *  notes-page.tsx), which lets it slide away, inert (`useLeaving`) while it does. */
export function SearchDrawer(props: { header: ReactNode; onClose: () => void }) {
  return <ReducedMotionConfig><Drawer {...props} /></ReducedMotionConfig>;
}

function Drawer({ header, onClose }: { header: ReactNode; onClose: () => void }) {
  const { openNote, showTask, goView } = useNav();
  const assistant = useAssistant();
  const lens = useActiveLens();
  const now = useNow();
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const f = useFinder(q, chips);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<"tags" | "delete" | null>(null);
  const [target, setTarget] = useState<string[]>([]);

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  const change = (v: string) => {
    const a = absorbTags(v);
    if (a.done.length) setChips((c) => [...c, ...a.done.filter((d) => !c.some((x) => fold(x) === fold(d)))]);
    setQ(a.text);
  };
  const choose = (name: string) => {
    setChips((c) => (c.some((x) => fold(x) === fold(name)) ? c : [...c, name]));
    setQ(dropTyping(q));
  };
  const backspace = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Backspace" && !q && chips.length) setChips((c) => c.slice(0, -1)); };
  const talk = useTalkOn();
  const views = useMemo(() => VIEWS.filter((v) => (talk || v.view === "ask" || v.view.kind !== "talk") && (!f.wanted || fold(v.label).includes(fold(f.wanted)))), [f.wanted, talk]);
  const go = (v: View | "ask") => { onClose(); if (v === "ask") assistant.show(); else goView(v); };
  const open = (id: string) => openNote(id);
  const task = (t: TaskRec) => showTask(homeOfTask(t), t.id);
  const ask = (kind: "tags" | "delete", path = menu?.path) => { if (path) setTarget([path]); setDialog(kind); };
  const tiles = (notes: { n: NoteRec; why?: string }[]) => (
    <Tiles notes={notes} now={now} onOpen={(n) => open(n.note.id)} onMenu={menuOf} onTag={choose}
      onTags={(p) => ask("tags", p)} onDelete={(p) => ask("delete", p)} />
  );
  const menuOf = (path: string) => (at: { x: number; y: number }) => setMenu({ path, ...at });

  const taskRow = (t: TaskRec, sub: string) => (
    <Row key={t.id}><button type="button" onClick={() => task(t)} className={row}>
      {t.done ? <Check className="size-5 shrink-0 text-dim" /> : <ListTodo className="size-5 shrink-0 text-dim" />}
      <span className="min-w-0 flex-1"><span className="block truncate">{t.title || "Untitled"}</span>{sub ? <span className="block truncate text-xs text-dim">{sub}</span> : null}</span>
    </button></Row>
  );
  const found = f.hits.length + f.taskHits.length + f.tags.length + views.length > 0;
  const reduce = useShouldReduceMotion();
  const enter = useTempoTransition(transition.sheet), leave = useTempoTransition(transition.dismiss);
  // The same transform function at both ends: Motion can't interpolate `none` with a translate
  const hidden = { opacity: 0, transform: reduce ? "translateY(0%)" : "translateY(-100%)" };

  // The page behind is live again the moment the drawer starts to leave (home.tsx, notes-page.tsx): the drawer must not stay tabbable over it
  const root = useLeaving<HTMLDivElement>(undefined, { sibling: false });

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col" role="search">
      <div className="relative z-10 bg-bg">{header}</div>
      {/* Clipped under the header, so the sheet comes out from behind it */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      <motion.div initial={hidden} animate={{ opacity: 1, transform: "translateY(0%)", transition: enter }} exit={{ ...hidden, transition: leave }}
        className="flex h-full min-h-0 flex-col bg-bg">
      <div className="px-4 pt-1 pb-2">
        <label className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-card px-3 py-1.5 focus-within:border-ring">
          <Search className="size-4 shrink-0 text-dim" />
          {chips.map((c) => <TagBadge key={c} name={c} onRemove={() => setChips((x) => x.filter((y) => fold(y) !== fold(c)))} />)}
          <input autoFocus value={q} onChange={(e) => change(e.target.value)} onKeyDown={backspace} placeholder={chips.length ? "" : "Search notes, tasks, or #tag"}
            aria-label="Search notes, tasks, or #tag" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
            className="min-w-24 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-faint" />
          <MicButton className="-mr-2" onText={(t) => change(q.trim() ? `${q.trimEnd()} ${t}` : t)} />
        </label>
        {lens ? <p className="px-1 pt-2 text-xs text-faint">Searching inside {lens.name}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 max-md:pb-[calc(var(--under-tabs)+1.5rem)]">
        <LayoutGroup><AnimatePresence initial={false} mode="popLayout">
        {f.empty && q.trim() ? (
          <Section key="assistant" title="Assistant">
            {!f.asked ? <button type="button" onClick={f.ask} className={row}><Sparkles className="size-5 shrink-0 text-brand" /><span className="min-w-0"><span className="block">Search with the assistant</span><span className="block text-xs text-dim">Finds what you meant</span></span></button>
              : !f.asked.found && !f.asked.error ? <p className={cn(row, "text-dim")}><Loader2 className="size-5 shrink-0 animate-spin" /><ShimmeringText text="Looking through your notes and tasks…" color="var(--tf-dim)" shimmeringColor="var(--tf-fg)" /></p>
              : f.asked.error ? <button type="button" onClick={f.ask} className={row}><Sparkles className="size-5 shrink-0 text-brand" /><span className="min-w-0"><span className="block">Couldn't search. Try again</span><span className="block text-xs text-dim">{f.asked.error}</span></span></button>
              : !f.foundNotes.length && !f.foundTasks.length ? <p className={cn(row, "text-dim")}><Sparkles className="size-5 shrink-0" />The assistant found nothing either</p> : null}
            {f.foundNotes.length ? tiles(f.foundNotes) : null}
            <AnimatePresence initial={false}>{f.foundTasks.map(({ t, why }) => taskRow(t, why))}</AnimatePresence>
          </Section>
        ) : null}
        {f.hits.length ? <Section key="notes" title="Notes" count={f.hits.length}>{tiles(f.hits.map((n) => ({ n })))}</Section> : null}
        {f.taskHits.length ? <Section key="tasks" title="Tasks" count={f.taskHits.length}><AnimatePresence initial={false}>{f.taskHits.map((t) => taskRow(t, [t.done ? "Completed" : "", t.notes].filter(Boolean).join(" · ")))}</AnimatePresence></Section> : null}
        {q.trim() && f.tags.length ? (
          <Section key="tags" title="Tags">
            <AnimatePresence initial={false}>{f.tags.map((t) => <Row key={t}><button type="button" onClick={() => choose(t)} className={row}><Hash className="size-5 shrink-0 text-dim" />{t}</button></Row>)}</AnimatePresence>
          </Section>
        ) : null}
        {views.length ? (
          <Section key="go" title="Go">
            <AnimatePresence initial={false}>{views.map((v) => { const Icon = v.icon; return <Row key={v.label}><button type="button" onClick={() => go(v.view)} className={row}><Icon className="size-5 shrink-0 text-dim" />{v.label}</button></Row>; })}</AnimatePresence>
          </Section>
        ) : null}
        {!found ? (
          <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid place-items-center gap-2 px-6 py-16 text-center">
            <SearchX className="size-8 text-line" /><p className="text-sm text-faint">Nothing matches</p>
          </motion.div>
        ) : null}
        </AnimatePresence></LayoutGroup>
      </div>
      </motion.div>
      </div>

      <MenuAt paths={menu ? [menu.path] : []} at={menu} onClose={() => setMenu(null)} onTags={() => ask("tags")} onDelete={() => ask("delete")} />
      <TagsDialog paths={target} open={dialog === "tags"} onOpenChange={(o) => { if (!o) setDialog(null); }} />
      <DeleteDialog paths={target} open={dialog === "delete"} onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={() => setDialog(null)} />
    </div>
  );
}
