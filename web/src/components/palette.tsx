// Global search: notes and tasks by their text and tags, plus navigation. Enter opens the selected result.
// A note shows as it does in the notes list (its picture, title, opening prose, tags, age, colour), and on a wide screen
// the highlighted one is previewed beside the results, its body as Markdown. When nothing matches, "Search with the assistant" asks the agent to
// look for what was meant (core/find.ts); its hits fill the same list, each with why it fits. No chat opens. A note row's
// actions are its right-click, and under a finger the ⋮ it shows. On a phone the dialog sits at the top, so the keyboard
// leaves the results room (the list takes what the viewport has left).
import { EllipsisVertical, Hash, House, ListTodo, Loader2, Plus, Sparkles } from "lucide-react";
import { ShimmeringText } from "@animate-ui/react/primitives/texts/shimmering";
import { useState } from "react";
import { ago } from "@/core/time";
import { fold } from "@/core/notes";
import { Markdown } from "@/components/markdown";
import { DeleteDialog, MenuAt, TagsDialog } from "@/components/note-actions";
import { NoteHit, Thumb } from "@/components/note-hit";
import { PaletteDialog } from "@/components/palette-dialog";
import { TagBadge } from "@/components/tag-badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAssistant } from "@/hooks/assistant";
import { useNow } from "@/hooks/now";
import { useFinder } from "@/hooks/search";
import { homeOfTask, titleOf, useNav, type View } from "@/lib/nav";
import { ms } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";

/** The highlighted note, larger: its picture across the top, the title and more of its prose. */
function Preview({ n, now }: { n: NoteRec; now: number }) {
  const tint = n.note.color;
  return (
    <div data-color={tint} className={cn("flex h-full flex-col overflow-hidden rounded-xl border", tint ? "border-tile-line/50 bg-tile text-tile-fg" : "border-line bg-card")}>
      <Thumb key={n.path} n={n} className="h-40 w-full shrink-0 bg-raised object-cover" />
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
        <h3 className="font-semibold text-base leading-snug">{n.note.title}</h3>
        {n.note.body.trim()
          ? <Markdown body={n.note.body} className={cn("text-[13px] [&_a]:pointer-events-none [&_img]:hidden [&_input]:pointer-events-none", tint ? "opacity-85" : "text-dim")} />
          : <p className="text-[13px] text-dim">Empty</p>}
        {n.note.tags.length ? <span className="flex flex-wrap gap-1">{n.note.tags.map((t) => <TagBadge key={t} name={t} />)}</span> : null}
        <span className={cn("text-[11px] tabular-nums", tint ? "text-tile-line" : "text-faint")}>Edited {ago(ms(n.updated), now)} · Enter to open</span>
      </div>
    </div>
  );
}

export function Palette({ open, onOpenChange, onNew }: { open: boolean; onOpenChange: (o: boolean) => void; onNew: () => void }) {
  const assistant = useAssistant();
  const { openNote, showTask, goView } = useNav();
  const [q, setQ] = useState("");
  const { hits, taskHits, tags, empty, asked, ask: askAgent, foundNotes, foundTasks } = useFinder(q);
  const destinations: View[] = [{ kind: "home" }, { kind: "today" }, { kind: "inbox" }, { kind: "upcoming" }, { kind: "logbook" }, { kind: "notes" }, { kind: "settings" }];
  const now = useNow();
  const [active, setActive] = useState("");
  const previewed = hits.find((n) => n.path === active) ?? foundNotes.find((h) => h.n.path === active)?.n;
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);   // a note row's right-click menu
  const [dialog, setDialog] = useState<"tags" | "delete" | null>(null);                 // opened from it, over `target`
  const [target, setTarget] = useState<string[]>([]);
  const ask = (kind: "tags" | "delete") => { if (menu) setTarget([menu.path]); setDialog(kind); };
  const run = (f: () => void) => { onOpenChange(false); setQ(""); f(); };

  return (
    <PaletteDialog open={open} onOpenChange={onOpenChange} title="Search everything" description="Notes, tasks, tags and views. #tag narrows to a tag.">
      <Command shouldFilter={false} value={active} onValueChange={setActive}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search notes, tasks, or #tag…" />
        <div className="flex min-h-0">
        <CommandList className="max-h-[calc(100dvh-6rem)] min-w-0 flex-1 overscroll-contain md:max-h-[65vh]">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {hits.length ? (
            <CommandGroup heading="Notes">
              {hits.map((n) => (
                <CommandItem key={n.path} value={n.path} onSelect={() => run(() => openNote(n.note.id))} className="items-start py-2"
                  onContextMenu={(e) => { e.preventDefault(); setActive(n.path); setMenu({ path: n.path, x: e.clientX, y: e.clientY }); }}>
                  <NoteHit n={n} now={now} />
                  <button type="button" aria-label="Note actions" title="Note actions"
                    onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setActive(n.path); setMenu({ path: n.path, x: r.left, y: r.bottom }); }}
                    className="-my-2 -mr-2 hidden size-10 shrink-0 place-items-center self-center rounded-md text-dim any-pointer-coarse:grid"><EllipsisVertical className="size-4" /></button>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {empty ? (
            <CommandGroup heading="Assistant">
              {!asked ? <CommandItem value="find" onSelect={askAgent}><Sparkles /> Search with the assistant <span className="ml-auto text-xs text-faint">finds what you meant</span></CommandItem>
                : !asked.found && !asked.error ? <CommandItem value="finding" disabled><Loader2 className="animate-spin" /> <ShimmeringText text="Looking through your notes and tasks…" color="var(--tf-dim)" shimmeringColor="var(--tf-fg)" /></CommandItem>
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
    </PaletteDialog>
  );
}
