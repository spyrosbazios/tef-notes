// Global search: notes and tasks by their text and tags, plus navigation. Enter opens the selected result.
// A note shows as it does in the notes list (its picture, title, opening prose, tags, age, colour), and on a wide screen
// the highlighted one is previewed beside the results. When nothing matches, "Search with the assistant" asks the agent to
// look for what was meant (core/find.ts); its hits fill the same list, each with why it fits. No chat opens.
import { Hash, House, ListTodo, Loader2, Pin, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago } from "@/core/time";
import { TagBadge } from "@/components/tag-badge";
import { useNow } from "@/hooks/now";
import { useNotePictures } from "@/hooks/thumbs";
import { Mosaic } from "./note-pictures";
import { ms } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";
import { findByAsking } from "@/services/find";
import { message } from "@/services/api";
import type { Found } from "@/core/find";
import { snippetOf } from "@/core/notes";
import { matchesTask, parseTagQuery, suggestTags, typingTag } from "@/core/tags";
import { DeleteDialog, MenuAt, TagsDialog } from "@/components/note-actions";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAssistant } from "@/hooks/assistant";
import { useLensSorted } from "@/hooks/notes";
import { useTagNames } from "@/hooks/tag-names";
import { useNav } from "@/lib/nav";
import { useLensTasks } from "@/hooks/todo";
import { homeOfTask, titleOf, type View } from "@/lib/nav";
import { fold } from "@/core/notes";
import { matches } from "@/lib/search";

/** A note's pictures as a small mosaic, or nothing when it has none or they fail to load. */
function Thumb({ n, className }: { n: NoteRec; className: string }) {
  const [ref, pictures, more] = useNotePictures<HTMLSpanElement>(n.note.id, n.note.body);
  return <span ref={ref} className="contents"><Mosaic sources={pictures} more={more} className={className} /></span>;
}

/** A note as a result row: its picture, title, two lines of prose, tags and age. Its colour shows in the preview. */
function NoteHit({ n, now, why }: { n: NoteRec; now: number; why?: string }) {
  const snippet = useMemo(() => why || snippetOf(n.note.body, 200), [why, n.note.body]);
  return (
    <span className="flex w-full min-w-0 items-start gap-3">
      <Thumb n={n} className="size-14 shrink-0 rounded-md border border-line" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{n.note.title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">{n.note.pinned ? <Pin className="mr-1 inline size-3" /> : null}{ago(ms(n.updated), now)}</span>
        </span>
        <span className={cn("line-clamp-2 text-xs", why ? "text-fg" : "text-dim")}>{why ? <Sparkles className="mr-1 inline size-3 text-dim" /> : null}{snippet || "Empty"}</span>
        {n.note.tags.length ? <span className="flex flex-wrap gap-1 pt-0.5">{n.note.tags.slice(0, 4).map((t) => <TagBadge key={t} name={t} />)}</span> : null}
      </span>
    </span>
  );
}

/** The highlighted note, larger: its picture across the top, the title and more of its prose. */
function Preview({ n, now }: { n: NoteRec; now: number }) {
  const snippet = useMemo(() => snippetOf(n.note.body, 900), [n.note.body]);
  const tint = n.note.color;
  return (
    <div data-color={tint} className={cn("flex h-full flex-col overflow-hidden rounded-xl border", tint ? "border-tile-line/50 bg-tile text-tile-fg" : "border-line bg-card")}>
      <Thumb key={n.path} n={n} className="h-40 w-full shrink-0 bg-raised object-cover" />
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
        <h3 className="font-semibold text-base leading-snug">{n.note.title}</h3>
        <p className={cn("whitespace-pre-line text-[13px] leading-relaxed", tint ? "opacity-85" : "text-dim")}>{snippet || "Empty"}</p>
        {n.note.tags.length ? <span className="flex flex-wrap gap-1">{n.note.tags.map((t) => <TagBadge key={t} name={t} />)}</span> : null}
        <span className={cn("text-[11px] tabular-nums", tint ? "text-tile-line" : "text-faint")}>Edited {ago(ms(n.updated), now)} · Enter to open</span>
      </div>
    </div>
  );
}

export function Palette({ open, onOpenChange, onNew }: { open: boolean; onOpenChange: (o: boolean) => void; onNew: () => void }) {
  const assistant = useAssistant();
  const sorted = useLensSorted();
  const { openNote, showTask, goView } = useNav();
  const [q, setQ] = useState("");
  const hits = useMemo(() => sorted.filter(matches(q)).slice(0, 50), [sorted, q]);
  const tasks = useLensTasks();
  const taskHits = useMemo(() => tasks.data.filter(matchesTask(q)).slice(0, 50), [tasks.data, q]);
  const destinations: View[] = [{ kind: "home" }, { kind: "today" }, { kind: "inbox" }, { kind: "upcoming" }, { kind: "logbook" }, { kind: "settings" }];
  const names = useTagNames();
  // Tag names holding what is typed, folded (case, tonos): the `#ho` being typed, else the last `#tag`, else the text.
  const tags = useMemo(() => suggestTags(names, typingTag(q) ?? parseTagQuery(q).tags.at(-1) ?? q), [names, q]);
  const now = useNow();
  const [active, setActive] = useState("");
  // The assistant's search for `q`: running, its hits, or why it failed. Typing on drops it (and stops one running).
  const [asked, setAsked] = useState<{ q: string; found?: Found; error?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const type = (v: string) => { setQ(v); abort.current?.abort(); setAsked(null); };
  const askAgent = () => {
    abort.current?.abort();
    const c = abort.current = new AbortController(), asking = q;
    setAsked({ q: asking });
    findByAsking(asking, c.signal).then((found) => { if (!c.signal.aborted) setAsked({ q: asking, found }); },
      (e) => { if (!c.signal.aborted) setAsked({ q: asking, error: message(e) }); });
  };
  const byPath = useMemo(() => new Map(sorted.map((n) => [n.path, n])), [sorted]);
  const foundNotes = asked?.found?.notes.flatMap((h) => byPath.get(h.path) ? [{ n: byPath.get(h.path)!, why: h.why }] : []) ?? [];
  const foundTasks = asked?.found?.tasks.flatMap((h) => { const t = tasks.data.find((x) => x.id === h.id); return t ? [{ t, why: h.why }] : []; }) ?? [];
  const empty = !!q.trim() && !hits.length && !taskHits.length;
  const previewed = hits.find((n) => n.path === active) ?? foundNotes.find((h) => h.n.path === active)?.n;
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);   // a note row's right-click menu
  const [dialog, setDialog] = useState<"tags" | "delete" | null>(null);                 // opened from it, over `target`
  const [target, setTarget] = useState<string[]>([]);
  const ask = (kind: "tags" | "delete") => { if (menu) setTarget([menu.path]); setDialog(kind); };
  const run = (f: () => void) => { onOpenChange(false); type(""); f(); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search everything" description="Notes, tasks, tags and views. #tag narrows to a tag." className="sm:max-w-2xl md:max-w-4xl">
      <Command shouldFilter={false} value={active} onValueChange={setActive}>
        <CommandInput value={q} onValueChange={type} placeholder="Search notes, tasks, or #tag…" />
        <div className="flex min-h-0">
        <CommandList className="max-h-[65vh] min-w-0 flex-1">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {hits.length ? (
            <CommandGroup heading="Notes">
              {hits.map((n) => (
                <CommandItem key={n.path} value={n.path} onSelect={() => run(() => openNote(n.note.id))} className="items-start py-2"
                  onContextMenu={(e) => { e.preventDefault(); setActive(n.path); setMenu({ path: n.path, x: e.clientX, y: e.clientY }); }}>
                  <NoteHit n={n} now={now} />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {empty ? (
            <CommandGroup heading="Assistant">
              {!asked ? <CommandItem value="find" onSelect={askAgent}><Sparkles /> Search with the assistant <span className="ml-auto text-xs text-faint">finds what you meant</span></CommandItem>
                : !asked.found && !asked.error ? <CommandItem value="finding" disabled><Loader2 className="animate-spin" /> Looking through your notes and tasks…</CommandItem>
                : asked.error ? <CommandItem value="find" onSelect={askAgent}><Sparkles /> Couldn't search: {asked.error}. Try again</CommandItem>
                : !foundNotes.length && !foundTasks.length ? <CommandItem value="none" disabled>The assistant found nothing either.</CommandItem> : null}
              {foundNotes.map(({ n, why }) => (
                <CommandItem key={n.path} value={n.path} onSelect={() => run(() => openNote(n.note.id))} className="items-start py-2">
                  <NoteHit n={n} now={now} why={why} />
                </CommandItem>
              ))}
              {foundTasks.map(({ t, why }) => <CommandItem key={t.id} value={`task:${t.id}`} onSelect={() => run(() => showTask(homeOfTask(t), t.id))}>
                <ListTodo /><span className="min-w-0"><span className="block truncate">{t.title}</span><span className="block truncate text-xs">{why}</span></span>
              </CommandItem>)}
            </CommandGroup>
          ) : null}
          {taskHits.length ? <CommandGroup heading="Tasks">
            {taskHits.map((t) => <CommandItem key={t.id} value={`task:${t.id}`} onSelect={() => run(() => showTask(homeOfTask(t), t.id))}>
              <ListTodo /><span className="min-w-0"><span className="block truncate">{t.title}</span><span className="block truncate text-xs text-dim">{t.done ? "Completed · " : ""}{t.notes}</span></span>
            </CommandItem>)}
          </CommandGroup> : null}
          {q && <CommandGroup heading="Go">{destinations.filter((v) => fold(titleOf(v)).includes(fold(q))).map((v) => <CommandItem key={v.kind} value={`view:${v.kind}`} onSelect={() => run(() => goView(v))}>{titleOf(v)}</CommandItem>)}</CommandGroup>}
          {tags.length ? (
            <CommandGroup heading="Tags">
              {tags.map((t) => <CommandItem key={t} value={`tag:${t}`} onSelect={() => run(() => goView({ kind: "home", tags: [t] }))}><Hash /> {t}</CommandItem>)}
            </CommandGroup>
          ) : null}
          {!q ? (
            <CommandGroup heading="Go">
              <CommandItem value="new" onSelect={() => run(onNew)}><Plus /> New note</CommandItem>
              <CommandItem value="home" onSelect={() => run(() => goView({ kind: "home" }))}><House /> Home</CommandItem>
              {destinations.filter((v) => ["today", "inbox", "upcoming", "logbook", "settings"].includes(v.kind)).map((v) => <CommandItem key={v.kind} value={`view:${v.kind}`} onSelect={() => run(() => goView(v))}>{titleOf(v)}</CommandItem>)}
              <CommandItem value="ask" onSelect={() => run(() => assistant.show())}><Sparkles /> Ask the assistant</CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
        {previewed ? <aside className="hidden w-80 shrink-0 border-l border-line p-3 md:block" aria-label="Preview"><Preview n={previewed} now={now} /></aside> : null}
        </div>
      </Command>
      <MenuAt paths={menu ? [menu.path] : []} at={menu} onClose={() => setMenu(null)} onTags={() => ask("tags")} onDelete={() => ask("delete")} />
      <TagsDialog paths={target} open={dialog === "tags"} onOpenChange={(o) => { if (!o) setDialog(null); }} />
      <DeleteDialog paths={target} open={dialog === "delete"} onOpenChange={(o) => { if (!o) setDialog(null); }} onDone={() => setDialog(null)} />
    </CommandDialog>
  );
}
