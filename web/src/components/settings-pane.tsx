// Settings: the look (theme and accent), the phone's tabs and where the app opens (all the owner's preferences, on the server,
// hooks/prefs.ts), the server and the offline copy this browser keeps, the agent (which model
// Ask uses, how hard it thinks, whether it writes notes without asking: preferences too; what it remembers of the owner,
// agent/memory.md: shown, not edited), task reminders on this device (Web Push), the tag definitions (kept on the server, so the
// phone sees them too, and the server tags notes with them itself; notes' own tags are not touched by renaming or deleting a
// definition), and import and export. A window lists the sections beside the page; below `md` the list is the page and a
// section opens over it (`?section=`), as the phone's Settings tab does.
import { PageHeader } from "@/components/page-header";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { ArrowDownUp, Bell, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Download, GripVertical, LayoutGrid, Loader2, Mic, Palette, Pencil, Plus, RefreshCw, Server, Settings, Sparkles, Tag as TagIcon, Trash2, Upload, Wrench, type LucideIcon } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { COLORS, type Color } from "@/core/notes";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { Conflict } from "@/core/pocketbase";
import { HIDEABLE, movedTab, START_LABEL, STARTS, TAB_LABELS, TAB_LABELS_LABEL, TAB_LABEL, TASK_LIST_LABEL, TASK_LISTS, type Tab } from "@/core/prefs";
import { undefinedTags, type TagDef } from "@/core/tags";
import { KEEP_LABEL, KEEPS } from "@/core/voice";
import { ModelMenu } from "@/components/assistant/model-menu";
import { Markdown } from "@/components/markdown";
import { MicButton } from "@/components/mic-button";
import { Conflicts } from "@/components/sync-conflicts";
import { TagBadge } from "@/components/tag-badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useModel } from "@/hooks/agent";
import { useAppearance } from "@/hooks/appearance";
import { useRowDrag } from "@/hooks/drag";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";
import { TAB_ICON } from "@/components/tab-icons";
import { useNarrow } from "@/hooks/media";
import { useOnline } from "@/hooks/online";
import { useSyncStatus } from "@/hooks/sync";
import { usePush } from "@/hooks/push";
import { clearOffline, keptFiles } from "@/lib/offline";
import { syncNow } from "@/lib/sync";
import { useTasks } from "@/hooks/todo";
import { useNotes } from "@/hooks/notes";
import { downloadZip } from "@/lib/export";
import { importNotes, type ImportTally, type Source } from "@/core/import";
import { folderSource, zipSource } from "@/lib/import";
import type { SettingsSection } from "@/lib/route-search";
import { settingsScroll } from "@/lib/scroll";
import { localDay } from "@/core/time";
import { useCreateTag, useDescribeTag, useRemoveTag, useTags, useUpdateTag } from "@/hooks/tags";
import { message } from "@/services/api";
import { memory } from "@/services/notes";
import { cn } from "@/lib/utils";
import { builtAt } from "@/lib/persist";
import { appVersion, forceUpdate } from "@/lib/update";

/** A tag is one word: it is written on the note's `tags:` line and typed as `#tag` in search. */
const clean = (v: string) => v.trim().replace(/^#/, "");
/** A section's title stays at the top of the scrolling page. */
const HEAD = "sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-2 font-bold text-lg tracking-tight backdrop-blur";
const BAD = /[\s,[\]{}"\\]/;

/** `name`: a new tag's name to start from (one notes already carry). */
function TagDialog({ tag, name: start, onClose }: { tag: TagDef | null; name?: string; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? start ?? ""), [color, setColor] = useState<Color | undefined>(tag?.color), [description, setDescription] = useState(tag?.description ?? "");
  const create = useCreateTag(), update = useUpdateTag(), describe = useDescribeTag();
  const n = clean(name), bad = BAD.test(n);
  const busy = create.isPending || update.isPending;
  const generate = () => describe.mutate(n, { onSuccess: setDescription, onError: (err) => toast.error(message(err)) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!n || bad) return;
    const fields = { name: n, color, description };
    try {
      if (tag) await update.mutateAsync({ rec: tag.rec, fields }); else await create.mutateAsync(fields);
      onClose();
    } catch (err) {
      toast.error(err instanceof Conflict ? `There is a tag called “${n}” already.` : message(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
            <DialogDescription>{tag ? "Notes already carrying the old name keep it." : "A tag is one word, written on a note and typed as #tag in search."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name</Label>
            <Input id="tag-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="home" aria-invalid={bad} />
            {bad ? <p className="text-xs text-down">No spaces, commas, brackets or quotes.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" data-color={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
                  className={cn("grid size-7 place-items-center rounded-full border-2 bg-tile text-tile-fg", color === c ? "border-tile-fg" : "border-tile-line/50")}>
                  {color === c ? <Check className="size-3.5" /> : null}
                </button>
              ))}
              <Button type="button" variant="ghost" size="sm" aria-pressed={!color} className={cn("rounded-full", !color && "bg-muted")} onClick={() => setColor(undefined)}>None</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="tag-desc">What it means</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full text-xs" disabled={!n || bad || describe.isPending} onClick={generate}>
                <Sparkles className="size-3.5" />{describe.isPending ? "Writing…" : "Generate from notes"}
              </Button>
            </div>
            <Textarea id="tag-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="Optional. Read by the AI when it decides whether a note belongs here." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="rounded-full" disabled={!n || bad || busy}>{tag ? "Save" : "Add tag"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What each theme is for, under its name (the phone's Settings words). */
const ABOUT: Record<ThemeName, string> = {
  oled: "True black. Easiest on the battery at night.",
  dark: "Dark grey, softer than black.",
  midnight: "Deep navy, cooler than grey.",
  forest: "Green-black, calm and earthy.",
  mocha: "Catppuccin's pastels on a cosy dark.",
  nord: "Arctic blue-grey, dimmed and calm.",
  rosepine: "Faux fur and pine: plum dark, rose brand.",
  tokyo: "Downtown lights on a night-blue ground.",
  gruvbox: "Retro groove: warm greys, cream text.",
  light: "Near-white, for daylight.",
  mist: "Cool blue-grey daylight.",
  dawn: "Soft blush paper, warm and bright.",
  sepia: "Warm paper, low glare for reading.",
  latte: "Catppuccin's pastels in daylight.",
  snow: "Nord's snow storm, inked in polar night.",
  solar: "Solarized's cream, blue on yellowed paper.",
};

/** A theme's look in small: its ground, a card on it, and its brand (the picked accent on it). */
function Swatch({ name, accent }: { name: ThemeName; accent: AccentName }) {
  const { C } = withAccent(THEMES[name], accent);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ backgroundColor: C.bg, borderColor: C.line }}>
      <span className="flex h-5 w-6 items-end justify-end rounded-md p-[3px]" style={{ backgroundColor: C.card }}>
        <span className="size-2 rounded-full" style={{ backgroundColor: C.brand }} />
      </span>
    </span>
  );
}

function Appearance() {
  const { theme, accent, set } = useAppearance();
  const label = (a: AccentName) => (a === "theme" ? `${THEMES[theme].label}'s own` : ACCENTS[a].label);
  return (
    <section className="space-y-3" aria-labelledby="appearance-h">
      <h2 id="appearance-h" className={HEAD}>Appearance</h2>
      <p className="text-sm text-dim">Kept on the server: every device you open the app on has the same.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="space-y-2.5 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p id="accent-h" className="text-sm font-semibold">Primary colour</p>
            <span className="text-[13px] text-dim">{label(accent)}</span>
          </div>
          <div role="radiogroup" aria-labelledby="accent-h" className="flex flex-wrap gap-2">
            {ACCENT_NAMES.map((a) => {
              const on = a === accent, colour = accentColor(THEMES[theme], a);
              return (
                <button key={a} type="button" role="radio" aria-checked={on} aria-label={label(a)} title={label(a)} onClick={() => set({ accent: a })}
                  className="grid size-11 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: on ? colour : "transparent" }}>
                  <span className="grid size-8 place-items-center rounded-full" style={{ backgroundColor: colour }}>
                    {on ? <Check className="size-4 text-bg" strokeWidth={3} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2.5 px-3 py-2.5">
          <p id="theme-h" className="text-sm font-semibold">Theme</p>
          <div role="radiogroup" aria-labelledby="theme-h" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEME_NAMES.map((n) => {
              const on = n === theme;
              return (
                <button key={n} type="button" role="radio" aria-checked={on} onClick={() => set({ theme: n })}
                  className={cn("flex flex-col items-start gap-2 rounded-xl border-2 p-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand" : "border-line")}>
                  <span className="flex w-full items-start justify-between">
                    <Swatch name={n} accent={accent} />
                    {on ? <Check className="size-4 text-brand" strokeWidth={2.6} /> : null}
                  </span>
                  <span className="block text-sm font-semibold">{THEMES[n].label}</span>
                  <span className="block text-[13px] leading-snug text-dim">{ABOUT[n]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A row of small radio buttons. */
function Choice<T extends string>({ label, value, options, names, onPick }: { label: string; value: T; options: readonly T[]; names: Record<T, string>; onPick: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o} type="button" role="radio" aria-checked={o === value} size="sm" variant={o === value ? "default" : "outline"} onClick={() => onPick(o)}>{names[o]}</Button>
      ))}
    </div>
  );
}

/** What a tab's row opens to, when it has a choice of its own. */
function TabOptions({ tab }: { tab: Tab }) {
  const { homeList, tasksList } = usePrefs();
  if (tab === "home") return (
    <div className="space-y-2 pb-1"><p className="text-[13px] text-dim">Home's task box opens on</p>
      <Choice label="Home's task box opens on" value={homeList} options={TASK_LISTS} names={TASK_LIST_LABEL} onPick={(v) => setPrefs({ homeList: v })} /></div>
  );
  if (tab === "tasks") return (
    <div className="space-y-2 pb-1"><p className="text-[13px] text-dim">The Tasks tab opens on</p>
      <Choice label="The Tasks tab opens on" value={tasksList} options={TASK_LISTS} names={TASK_LIST_LABEL} onPick={(v) => setPrefs({ tasksList: v })} /></div>
  );
  return null;
}

/** The phone's bottom bar and where the app opens (core/prefs.ts): the tabs dragged into order (a finger by the grip), shown or
 *  hidden, and Home and Tasks tapped open for the list each starts on. */
function Layout() {
  const { tabs, hidden, start, tabLabels } = usePrefs();
  const [open, setOpen] = useState<Tab | null>(null);
  const drag = useRowDrag((_g, id, over, after) => setPrefs({ tabs: movedTab(prefsNow().tabs, id as Tab, over as Tab, after) }));
  return (
    <section className="space-y-3" aria-labelledby="layout-h">
      <h2 id="layout-h" className={HEAD}>Layout</h2>
      <p className="text-sm text-dim">The tabs at the bottom of the phone, what each opens on, and the screen the app starts on. Kept on the server, like the look.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="space-y-2.5 px-3 py-2.5">
          <p className="text-sm font-semibold">Open the app on</p>
          <Choice label="Open the app on" value={start} options={STARTS} names={START_LABEL} onPick={(v) => setPrefs({ start: v })} />
        </div>
        <div className="space-y-2.5 px-3 py-2.5">
          <p className="text-sm font-semibold">Tab labels</p>
          <Choice label="Tab labels" value={tabLabels} options={TAB_LABELS} names={TAB_LABELS_LABEL} onPick={(v) => setPrefs({ tabLabels: v })} />
        </div>
        <div className="px-3 py-2.5">
          <p className="text-sm font-semibold">Tabs</p>
          <p className="text-[13px] leading-snug text-dim">Drag to reorder. Tap Home or Tasks to pick the list it opens on. Settings stays, so the bar can always be changed back.</p>
        </div>
        <ul aria-label="Tabs" className="divide-y divide-line">
          {tabs.map((t) => {
            const shown = !hidden.includes(t), d = drag("tabs", t), opens = t === "home" || t === "tasks", Icon = TAB_ICON[t];
            return (
              <li key={t} {...d.props} className={cn("relative select-none", d.dragging && "opacity-40")}>
                {d.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", d.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
                <div className="flex items-center gap-2 px-1.5 py-1">
                  <span data-drag-handle aria-hidden className="grid size-9 shrink-0 cursor-grab touch-none place-items-center text-faint"><GripVertical className="size-4" /></span>
                  <button type="button" disabled={!opens} aria-expanded={opens ? open === t : undefined} onClick={() => setOpen(open === t ? null : t)}
                    className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-muted">
                    <Icon className={cn("size-4 shrink-0", shown ? "text-brand" : "text-faint")} />
                    <span className={cn("min-w-0 flex-1 text-sm", !shown && "text-faint")}>{TAB_LABEL[t]}</span>
                    {opens ? <ChevronDown className={cn("size-4 text-faint transition-transform", open === t && "rotate-180")} /> : null}
                  </button>
                  {HIDEABLE.includes(t) ? (
                    <Switch checked={shown} aria-label={`Show ${TAB_LABEL[t]}`} className="mr-1.5"
                      onCheckedChange={(on) => setPrefs({ hidden: on ? hidden.filter((h) => h !== t) : [...hidden, t] })} />
                  ) : null}
                </div>
                {open === t ? <div className="pr-3 pl-12"><TabOptions tab={t} /></div> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Tags() {
  const { data, isPending, isError } = useTags();
  const { data: notes = [] } = useNotes();
  const remove = useRemoveTag();
  const { data: tasks = [] } = useTasks();
  const [editing, setEditing] = useState<TagDef | null | undefined>(undefined);     // undefined: closed, null: a new one
  const [defining, setDefining] = useState<string>();                                // a new one's name, from the tags in use
  const [deleting, setDeleting] = useState<TagDef>();
  const [q, setQ] = useState("");
  const loose = useMemo(() => undefinedTags(data ?? [], [...notes.map((n) => n.note.tags), ...tasks.map((t) => t.tags)]), [data, notes, tasks]);
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of n.note.tags) m.set(t.toLowerCase(), (m.get(t.toLowerCase()) ?? 0) + 1);
    for (const t of tasks) for (const g of t.tags) m.set(g.toLowerCase(), (m.get(g.toLowerCase()) ?? 0) + 1);
    return m;
  }, [notes, tasks]);
  const find = clean(q).toLowerCase(), hit = (name: string) => !find || name.toLowerCase().includes(find);
  const count = (name: string) => used.get(name.toLowerCase()) ?? 0;
  const defs = (data ?? []).filter((t) => hit(t.name)).toSorted((a, b) => count(b.name) - count(a.name) || a.name.localeCompare(b.name));
  const looseShown = loose.filter((t) => hit(t.name)).toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const confirmDelete = async () => {
    if (!deleting) return;
    try { await remove.mutateAsync(deleting); } catch (e) { toast.error(message(e)); }
    setDeleting(undefined);
  };

  return (
    <section className="space-y-3" aria-labelledby="tags-h">
      <div className={cn(HEAD, "flex items-center gap-2")}>
        <h2 id="tags-h" className="flex-1 font-bold text-lg tracking-tight">Tags</h2>
        <Button size="sm" className="rounded-full" onClick={() => setEditing(null)}><Plus /> Add tag</Button>
      </div>
      <p className="text-sm text-dim">A tag's colour paints its badge on every device. The description is what the AI reads to decide whether a note belongs.
        The server tags notes itself, about a minute after a save: every tag that likely fits goes on, and one you take off stays off.</p>
      {data?.length || loose.length ? (
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags" aria-label="Search tags" />
      ) : null}
      {isPending ? <Skeleton className="h-16 rounded-xl" /> : isError ? <p className="text-sm text-down">The tags can't be loaded.</p>
        : defs.length || looseShown.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {defs.map((t) => (
              <li key={t.rec} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2"><TagBadge name={t.name} /><span className="text-xs tabular-nums text-faint">{count(t.name)} {count(t.name) === 1 ? "item" : "items"}</span></div>
                  {t.description ? <p className="text-[13px] leading-snug text-dim">{t.description}</p> : null}
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="text-dim" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 className="text-dim" /></Button>
              </li>
            ))}
            {looseShown.map((t) => (
              <li key={`loose:${t.name}`} className="flex items-start gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2"><TagBadge name={t.name} /><span className="text-xs tabular-nums text-faint">{t.count} {t.count === 1 ? "item" : "items"}</span></div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => { setDefining(t.name); setEditing(null); }}><Pencil className="text-dim" /></Button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-faint">{find ? `No tag matches “${find}”.` : "No tags defined yet."}</p>}


      {editing !== undefined ? <TagDialog key={editing?.rec ?? `new:${defining ?? ""}`} tag={editing} name={defining} onClose={() => { setEditing(undefined); setDefining(undefined); }} /> : null}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the tag “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Only its colour and description go. Notes keep the tag in their text, shown gray.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Agent() {
  const { models, unasked, set } = useModel();
  return (
    <div className="space-y-8">
    <section className="space-y-3" aria-labelledby="agent-h">
      <h2 id="agent-h" className={HEAD}>Agent</h2>
      <p className="text-sm text-dim">Ask answers from your notes and writes the ones you tell it to. The server holds the keys, and the model and the switch below, so every device has the same.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Model and effort</p></div>
          <ModelMenu align="end" />
        </div>
        <label className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Write notes without asking</span>
            <span className="block text-[13px] leading-snug text-dim">Off: every note it writes waits on a card for your yes. Once a chat has read the web, it asks anyway.</span>
          </span>
          <Switch checked={unasked} onCheckedChange={(v) => set({ unasked: v })} aria-label="Write notes without asking" />
        </label>
        {models ? (
          <div className="px-3 py-2.5">
            <p className="text-sm font-semibold">Web</p>
            <p className="text-[13px] text-dim">{models.web ? "The agent can search the web and read pages." : "Web search is off: the server has no search key."}</p>
          </div>
        ) : null}
      </div>
    </section>
    <Memory />
    </div>
  );
}

/** agent/memory.md: the agent's notes about the owner, which it rewrites itself. Shown, not edited here: it is the agent's record, not a note. */
function Memory() {
  const { data, isPending } = useQuery({ queryKey: ["memory"], queryFn: memory });
  return (
    <section className="space-y-3" aria-labelledby="memory-h">
      <h2 id="memory-h" className={HEAD}>Agent memory</h2>
      <p className="text-sm text-dim">The agent (Ask, here and on the phone) keeps this file about you and how you keep notes, and rewrites it on its own.</p>
      <div className="rounded-xl border border-line px-4 py-3">
        {isPending ? <Skeleton className="h-24" /> : data?.text.trim() ? <Markdown body={data.text} /> : <p className="text-sm text-faint">Empty: the agent hasn't written anything yet.</p>}
      </div>
    </section>
  );
}

/** Notes in and out, on one card. Export: every note and the photos and PDFs they link, as one zip (`notes/<file>.md` and
 * `attachments/<note-id>/<name>`). Import: a folder of Markdown, or such a zip, in as notes: picked, checked without writing,
 * then imported. */
function ImportExport() {
  const { data, isPending } = useNotes();
  const [exporting, setExporting] = useState(false);
  const [src, setSrc] = useState<{ name: string; source: Source; seen: ImportTally } | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = { url: location.origin };
  const download = async () => {
    if (!data) return;
    setExporting(true);
    try { toast(`Downloaded ${await downloadZip(data, `tefnotes-notes-${localDay()}.zip`)} notes`); } catch (e) { toast.error(message(e)); } finally { setExporting(false); }
  };
  const pick = async (name: string, make: () => Promise<Source> | Source) => {
    setBusy(true);
    try {
      const source = await make();
      const seen = await importNotes(here, source, { dry: true, update: false, today: localDay() });
      if (!seen.found) { toast.error(`No markdown files in ${name}`); setSrc(null); } else { setUpdate(false); setSrc({ name, source, seen }); }
    } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const t = await importNotes(here, src.source, { dry: false, update, today: localDay() });
      toast(`${t.made} new, ${t.updated} updated, ${t.same} unchanged, ${t.skipped} skipped; ${t.files} attachments`);
      setSrc(null);
    } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };
  const files = (e: { target: HTMLInputElement }) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; return f; };
  const count = src ? (update ? src.seen.found : src.seen.found - src.seen.taken) : 0;
  return (
    <section className="space-y-3" aria-labelledby="transfer-h">
      <h2 id="transfer-h" className={HEAD}>Import & export</h2>
      <p className="text-sm text-dim">Notes travel as plain markdown files, with the photos and PDFs they link. An export's zip imports back as it is.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <Download className="mt-0.5 size-4 shrink-0 self-start text-brand" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-semibold">Export</p>
            <p className="text-[13px] leading-snug text-dim">
              {isPending ? "Counting notes…" : `All ${data?.length ?? 0} notes in one zip.`} A single note downloads from its own menu.
            </p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full" disabled={isPending || exporting || !data?.length} onClick={() => { void download(); }}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} Download zip
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <Upload className="mt-0.5 size-4 shrink-0 self-start text-brand" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-semibold">Import</p>
            <p className="text-[13px] leading-snug text-dim">Every markdown file in a folder or zip becomes a note. You see what it finds before anything is written.</p>
          </div>
          <div className="flex items-center gap-2">
            {busy && !src && <Loader2 className="size-4 animate-spin text-dim" />}
            <Button asChild variant="outline" size="sm" className="rounded-full" disabled={busy}>
              <label>
                Folder
                <input type="file" className="sr-only" disabled={busy} {...{ webkitdirectory: "" }}
                  onChange={(e) => { const f = files(e); if (f.length) void pick(f[0].webkitRelativePath.split("/")[0] || "the folder", () => folderSource(f)); }} />
              </label>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full" disabled={busy}>
              <label>
                Zip
                <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy}
                  onChange={(e) => { const [f] = files(e); if (f) void pick(f.name, () => zipSource(f)); }} />
              </label>
            </Button>
          </div>
        </div>
        {src && (
          <div className="space-y-3 rounded-b-xl bg-muted/40 px-3 py-3" aria-live="polite">
            <p className="text-sm">
              <span className="font-semibold">{src.name}</span>
              <span className="text-dim"> · {src.seen.found} notes found{src.seen.taken > 0 ? `, ${src.seen.taken} already here` : ""}</span>
            </p>
            {src.seen.taken > 0 && (
              <div className="flex items-center gap-2">
                <Switch id="import-update" checked={update} onCheckedChange={setUpdate} />
                <Label htmlFor="import-update" className="text-[13px] text-dim">Overwrite the {src.seen.taken} already here (otherwise they are skipped)</Label>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="rounded-full" disabled={busy || count === 0} onClick={() => { void run(); }}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} {count === 0 ? "Nothing new to import" : `Import ${count} ${count === 1 ? "note" : "notes"}`}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-full" disabled={busy} onClick={() => setSrc(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The server this app talks to, what this browser keeps of it for offline, and clearing that. */
function ServerSync() {
  const qc = useQueryClient();
  const online = useOnline(), { waiting } = useSyncStatus();
  const { data: notes } = useNotes(), { data: tasks } = useTasks();
  const files = useQuery({ queryKey: ["offline-files"], queryFn: keptFiles });
  const [asking, setAsking] = useState(false);
  const worker = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
  const sync = () => { void Promise.all([syncNow(), qc.invalidateQueries()]).then(() => toast("Up to date")); };
  return (
    <section className="space-y-3" aria-labelledby="server-h">
      <h2 id="server-h" className={HEAD}>Server &amp; sync</h2>
      <p className="text-sm text-dim">Notes, photos and the agent live on the server this page was loaded from. There is no sign-in: it must only be reachable on a private network.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Line title="Server" detail={location.host} trailing={<span className={cn("text-[13px]", online ? "text-dim" : "text-warn")}>{online ? "Reachable" : "Not reachable"}</span>} />
        <Line title="Sync now" detail="Send the changes made here that are waiting and fetch what changed on the server. Changes from other devices arrive by themselves while the app is open."
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={!online} onClick={sync}><RefreshCw /> Sync</Button>} />
        <Line title="Offline copy" detail={`${notes?.length ?? 0} notes and ${tasks?.length ?? 0} tasks kept for the next visit${waiting ? ` (${waiting} ${waiting === 1 ? "change" : "changes"} not sent yet)` : ""}${files.data ? `, ${files.data} attachment files` : ""}. ${worker ? "The app itself is installed for offline." : "The app's service worker isn't running, so only the page you have open works offline."}`} />
        <Conflicts />
        <Line title="Clear the offline copy" detail={waiting ? "Not while changes made here are waiting to be sent: clearing would lose them." : "Forgets what this browser kept. Nothing on the server changes; it comes down again the next time you open the app online."}
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={waiting > 0} onClick={() => setAsking(true)}><Trash2 /> Clear</Button>} />
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the offline copy?</AlertDialogTitle>
            <AlertDialogDescription>The app reloads and fetches your notes and tasks from the server again. Offline, nothing will open until you are back online once.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { clearOffline().catch((e) => toast.error(message(e))); }}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A row of a settings box: a name, a line under it, and a control at the end. */
function Line({ title, detail, trailing }: { title: string; detail?: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {detail ? <p className="text-[13px] leading-snug text-dim">{detail}</p> : null}
      </div>
      {trailing}
    </div>
  );
}

/** Task reminders on this device: Web Push. The server sends a task's reminder at its time, whether or not the app is open; the
 *  service worker shows it and a tap opens the task. */
function Reminders() {
  const { state, enable, disable, busy } = usePush();
  const on = state.kind === "on";
  const flip = (v: boolean) => (v ? enable : disable).mutate(undefined, {
    onSuccess: () => toast(v ? "Reminders are on for this device" : "Reminders are off for this device"),
    onError: (e) => toast.error(message(e)),
  });
  const detail = state.kind === "unavailable" ? `Not available: ${state.why}`
    : state.kind === "denied" ? "Notifications are blocked for this app. Allow them in the browser's site settings, then turn this on."
    : "Rings at the time a task's reminder is set to, even when the app is closed.";
  return (
    <section className="space-y-3" aria-labelledby="reminders-h">
      <h2 id="reminders-h" className={HEAD}>Reminders</h2>
      <p className="text-sm text-dim">A task with a day and a reminder time can notify you. Each device turns this on for itself; the server keeps the list of devices and sends the notifications.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <label className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Task reminders on this device</span>
            <span className="block text-[13px] leading-snug text-dim">{detail}</span>
          </span>
          {busy || state.kind === "loading" ? <Loader2 className="size-4 animate-spin text-dim" /> : null}
          <Switch checked={on} disabled={busy || state.kind === "loading" || state.kind === "unavailable" || state.kind === "denied"} onCheckedChange={flip} aria-label="Task reminders on this device" />
        </label>
      </div>
    </section>
  );
}

/** Voice input: the server's speech model (core/voice.ts), and how long it stays in the server's memory between clips. */
function Voice() {
  const { voice } = usePrefs();
  const [heard, setHeard] = useState("");
  return (
    <section className="space-y-3" aria-labelledby="voice-h">
      <h2 id="voice-h" className={HEAD}>Voice</h2>
      <p className="text-sm text-dim">Tap the mic in the assistant, a new task, a task's notes, a note or search, and speak English. Your server turns the speech into text with Parakeet, on its own CPU: the recording never leaves it and is not kept.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="space-y-2.5 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Keep the model loaded</p>
            <p className="text-[13px] leading-snug text-dim">The model takes about 1.5 GB of the server's memory while loaded. Loading it takes a few seconds, and starts the moment you tap the mic. Longer keeps the next dictation instant; shorter frees the memory sooner.</p>
          </div>
          <div role="radiogroup" aria-label="Keep the model loaded" className="flex flex-wrap gap-2">
            {KEEPS.map((k) => (
              <Button key={k} type="button" role="radio" aria-checked={k === voice.keep} size="sm" variant={k === voice.keep ? "default" : "outline"}
                onClick={() => setPrefs({ voice: { keep: k } })}>{KEEP_LABEL[k]}</Button>
            ))}
          </div>
        </div>
        <Line title="Try it" detail={heard || "Tap the mic and say something."} trailing={<MicButton onText={setHeard} />} />
      </div>
    </section>
  );
}

/** The sections, each its own page picked from the settings sidebar (or the list, below `md`). */
/** Which build this is, and fetching a newer one when the update toast hasn't shown up yet. */
function Maintenance() {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const reload = () => { setBusy(true); forceUpdate().catch((e) => { setBusy(false); toast.error(message(e)); }); };
  return (
    <section className="space-y-3" aria-labelledby="maintenance-h">
      <h2 id="maintenance-h" className={HEAD}>Maintenance</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Line title="Version" detail={`Built ${builtAt().toLocaleString()}`} trailing={<span className="text-[13px] text-dim tabular-nums">{appVersion()}</span>} />
        <Line title="Get the latest version" detail="Checks the server for a newer build and reloads into it now, instead of waiting for the update notice. Changes not sent yet stay on this device."
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={!online || busy} onClick={reload}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reload</Button>} />
      </div>
    </section>
  );
}

/** The sections, each its own page picked from the settings sidebar (or the list, below `md`). */
const SECTIONS = [
  { id: "appearance", label: "Appearance", about: "Theme and primary colour", icon: Palette, body: Appearance },
  { id: "layout", label: "Layout", about: "Phone tabs, what they open on, the start screen", icon: LayoutGrid, body: Layout },
  { id: "server", label: "Server & sync", about: "Server, offline copy", icon: Server, body: ServerSync },
  { id: "agent", label: "Agent", about: "Model, effort, write confirmations, memory", icon: Bot, body: Agent },
  { id: "voice", label: "Voice", about: "Dictation, how long the model stays loaded", icon: Mic, body: Voice },
  { id: "reminders", label: "Reminders", about: "Task notifications on this device", icon: Bell, body: Reminders },
  { id: "tags", label: "Tags", about: "Colours and descriptions", icon: TagIcon, body: Tags },
  { id: "transfer", label: "Import & export", about: "Markdown folders and zips, in and out", icon: ArrowDownUp, body: ImportExport },
  { id: "maintenance", label: "Maintenance", about: "Version, get the latest", icon: Wrench, body: Maintenance },
] as const satisfies readonly { id: SettingsSection; label: string; about: string; icon: LucideIcon; body: () => ReactNode }[];

export function SettingsPane() {
  const narrow = useNarrow(), { section } = useSearch({ from: "/_app/settings" });
  const asked = SECTIONS.find((s) => s.id === section);
  const at = asked ?? (narrow ? undefined : SECTIONS[0]);

  if (narrow) {
    return (
      <main className="flex h-full min-w-0 flex-1 flex-col">
        {at ? (
          <PageHeader title={at.label} className="pl-1" icon={
            <Link to="/settings" search={{}} aria-label="Back to Settings" className="grid size-9 shrink-0 place-items-center rounded-lg text-dim hover:bg-muted"><ChevronLeft className="size-[22px]" /></Link>} />
        ) : <PageHeader title="Settings" />}
        <div data-scroll-restoration-id={settingsScroll(at?.id ?? "")} className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-1 pb-28">
            {at ? <at.body /> : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {SECTIONS.map(({ id, label, about, icon: Icon }) => (
                  <li key={id}>
                    <Link to="/settings" search={{ section: id }} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                      <Icon className="size-5 shrink-0 text-brand" />
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{label}</span><span className="block text-[13px] text-dim">{about}</span></span>
                      <ChevronRight className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    );
  }
  const shown = at ?? SECTIONS[0], Body = shown.body;
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1">
      <nav aria-label="Settings sections" className="w-52 shrink-0 border-r border-line px-3 pt-8">
        <div className="mb-3 flex items-center gap-2 px-2 text-brand"><Settings className="size-5" /><span className="text-xs font-semibold uppercase tracking-wider">Settings</span></div>
        <Highlight controlledItems value={shown.id} className="inset-0 rounded-lg bg-muted">
          <div className="space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <HighlightItem key={id} value={id}>
                <Link to="/settings" search={{ section: id }} aria-current={id === shown.id ? "page" : undefined}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    id === shown.id ? "font-semibold text-fg" : "text-dim")}>
                  <Icon className="size-4" />{label}
                </Link>
              </HighlightItem>
            ))}
          </div>
        </Highlight>
      </nav>
      <article data-scroll-restoration-id={settingsScroll(shown.id)} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-24 md:px-10"><Body /></div>
      </article>
    </main>
  );
}
