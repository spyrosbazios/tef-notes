// Search on a phone (mobile/src/ui/search.tsx `SearchDrawer`): Home's drawer, opened by the header's search button, its results
// in place of the page. One field; under it the notes it finds, the tasks, tags and the screens to jump to. A finished `#tag`
// becomes a chip in the field (absorbed as it is typed, taken off with its x or Backspace) and narrows notes and tasks alike;
// a tag still being typed is a prefix, and the Tags rows offer the names (tap: a chip). Everything is inside the lens that is on.
// A long press on a note opens its actions. When words find no note or task, "Search with the assistant" asks the agent for what
// was meant (core/find.ts; the palette's too, hooks/search.ts), its hits filling the list with why each fits. The palette (⌘K)
// is the laptop's; this is the phone's, for the same data.
import { Archive, CalendarDays, Check, Hash, Inbox, ListTodo, Loader2, Search, SearchX, Settings, Sparkles, Star, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { absorbTags, dropTyping } from "@/core/tags";
import { fold } from "@/core/notes";
import { MenuAt, TagsDialog, DeleteDialog } from "@/components/note-actions";
import { NoteHit } from "@/components/note-hit";
import { TagBadge } from "@/components/tag-badge";
import { useAssistant } from "@/hooks/assistant";
import { useActiveLens } from "@/hooks/lens";
import { useLongPress } from "@/hooks/long-press";
import { useNow } from "@/hooks/now";
import { useFinder } from "@/hooks/search";
import { homeOfTask, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

const VIEWS: { label: string; icon: LucideIcon; view: View | "ask" }[] = [
  { label: "Inbox", icon: Inbox, view: { kind: "inbox" } }, { label: "Today", icon: Star, view: { kind: "today" } },
  { label: "Upcoming", icon: CalendarDays, view: { kind: "upcoming" } }, { label: "Logbook", icon: Archive, view: { kind: "logbook" } },
  { label: "Ask the assistant", icon: Sparkles, view: "ask" }, { label: "Settings", icon: Settings, view: { kind: "settings" } },
];

const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors active:bg-muted disabled:opacity-60";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pt-3"><h3 className="px-3 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">{title}</h3>{children}</section>;
}

/** A note result: a card in the note's own colour; holding it opens its actions. */
function Result({ n, now, why, onOpen, onMenu }: { n: NoteRec; now: number; why?: string; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void }) {
  const press = useLongPress(onMenu, { menu: true });
  const tint = n.note.color;
  return (
    <button type="button" onClick={onOpen} {...press} data-color={tint}
      className={cn("my-1 block w-full rounded-2xl border p-3 text-left select-none", tint ? "border-tile-line/50 bg-tile text-tile-fg" : "border-line bg-card")}>
      <NoteHit n={n} now={now} why={why} />
    </button>
  );
}

/** `header`: Home's top row, kept above the field; `onClose` puts the page back. */
export function SearchDrawer({ header, onClose }: { header: ReactNode; onClose: () => void }) {
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
  const views = useMemo(() => (f.wanted ? VIEWS.filter((v) => fold(v.label).includes(fold(f.wanted))) : VIEWS), [f.wanted]);
  const go = (v: View | "ask") => { onClose(); if (v === "ask") assistant.show(); else goView(v); };
  const open = (id: string) => openNote(id);
  const task = (t: TaskRec) => showTask(homeOfTask(t), t.id);
  const ask = (kind: "tags" | "delete") => { if (menu) setTarget([menu.path]); setDialog(kind); };
  const menuOf = (path: string) => (at: { x: number; y: number }) => setMenu({ path, ...at });

  const taskRow = (t: TaskRec, sub: string) => (
    <button key={t.id} type="button" onClick={() => task(t)} className={row}>
      {t.done ? <Check className="size-5 shrink-0 text-dim" /> : <ListTodo className="size-5 shrink-0 text-dim" />}
      <span className="min-w-0 flex-1"><span className="block truncate">{t.title || "Untitled"}</span>{sub ? <span className="block truncate text-xs text-dim">{sub}</span> : null}</span>
    </button>
  );
  const found = f.hits.length + f.taskHits.length + f.tags.length + views.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col" role="search">
      {header}
      <div className="px-4 pt-1 pb-2">
        <label className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-card px-3 py-1.5 focus-within:border-ring">
          <Search className="size-4 shrink-0 text-dim" />
          {chips.map((c) => <TagBadge key={c} name={c} onRemove={() => setChips((x) => x.filter((y) => fold(y) !== fold(c)))} />)}
          <input autoFocus value={q} onChange={(e) => change(e.target.value)} onKeyDown={backspace} placeholder={chips.length ? "" : "Search notes, tasks, or #tag"}
            aria-label="Search notes, tasks, or #tag" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
            className="min-w-24 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-faint" />
        </label>
        {lens ? <p className="px-1 pt-2 text-xs text-faint">Searching inside {lens.name}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
        {f.empty && q.trim() ? (
          <Section title="Assistant">
            {!f.asked ? <button type="button" onClick={f.ask} className={row}><Sparkles className="size-5 shrink-0 text-brand" /><span className="min-w-0"><span className="block">Search with the assistant</span><span className="block text-xs text-dim">Finds what you meant</span></span></button>
              : !f.asked.found && !f.asked.error ? <p className={cn(row, "text-dim")}><Loader2 className="size-5 shrink-0 animate-spin" />Looking through your notes and tasks…</p>
              : f.asked.error ? <button type="button" onClick={f.ask} className={row}><Sparkles className="size-5 shrink-0 text-brand" /><span className="min-w-0"><span className="block">Couldn't search. Try again</span><span className="block text-xs text-dim">{f.asked.error}</span></span></button>
              : !f.foundNotes.length && !f.foundTasks.length ? <p className={cn(row, "text-dim")}><Sparkles className="size-5 shrink-0" />The assistant found nothing either</p> : null}
            {f.foundNotes.map(({ n, why }) => <Result key={n.path} n={n} now={now} why={why} onOpen={() => open(n.note.id)} onMenu={menuOf(n.path)} />)}
            {f.foundTasks.map(({ t, why }) => taskRow(t, why))}
          </Section>
        ) : null}
        {f.hits.length ? <Section title="Notes">{f.hits.map((n) => <Result key={n.path} n={n} now={now} onOpen={() => open(n.note.id)} onMenu={menuOf(n.path)} />)}</Section> : null}
        {f.taskHits.length ? <Section title="Tasks">{f.taskHits.map((t) => taskRow(t, [t.done ? "Completed" : "", t.notes].filter(Boolean).join(" · ")))}</Section> : null}
        {q.trim() && f.tags.length ? (
          <Section title="Tags">
            {f.tags.map((t) => <button key={t} type="button" onClick={() => choose(t)} className={row}><Hash className="size-5 shrink-0 text-dim" />{t}</button>)}
          </Section>
        ) : null}
        {views.length ? (
          <Section title="Go">
            {views.map((v) => { const Icon = v.icon; return <button key={v.label} type="button" onClick={() => go(v.view)} className={row}><Icon className="size-5 shrink-0 text-dim" />{v.label}</button>; })}
          </Section>
        ) : null}
        {!found ? (
          <div className="grid place-items-center gap-2 px-6 py-16 text-center">
            <SearchX className="size-8 text-line" /><p className="text-sm text-faint">Nothing matches</p>
          </div>
        ) : null}
      </div>

      <MenuAt paths={menu ? [menu.path] : []} at={menu} onClose={() => setMenu(null)} onTags={() => ask("tags")} onDelete={() => ask("delete")} />
      <TagsDialog paths={target} open={dialog === "tags"} onOpenChange={(o) => { if (!o) setDialog(null); }} />
      <DeleteDialog paths={target} open={dialog === "delete"} onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={() => setDialog(null)} />
    </div>
  );
}
