// Settings: the look (theme and accent: this browser's), the agent (which model Ask uses, whether it writes notes without asking: this browser's choices), what the agent remembers of the owner (agent/memory.md: shown, not edited), the tag definitions, kept on the server, so the phone sees them too, and the server tags notes with
// them itself. Notes' own tags are not touched by renaming or deleting a definition.
import { useQuery } from "@tanstack/react-query";
import { Bot, Brain, Check, Download, Loader2, Palette, Pencil, Plus, Settings, Sparkles, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { COLORS, type Color } from "@/core/notes";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { Conflict } from "@/core/pocketbase";
import { undefinedTags, type TagDef } from "@/core/tags";
import { ModelMenu } from "@/components/assistant/model-menu";
import { Markdown } from "@/components/markdown";
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
import { useTasks } from "@/hooks/todo";
import { useNotes } from "@/hooks/notes";
import { downloadZip } from "@/lib/export";
import { importNotes, type ImportTally, type Source } from "@/core/import";
import { folderSource, zipSource } from "@/lib/import";
import { localDay } from "@/core/time";
import { useCreateTag, useDescribeTag, useRemoveTag, useTags, useUpdateTag } from "@/hooks/tags";
import { message } from "@/services/api";
import { memory } from "@/services/notes";
import { cn } from "@/lib/utils";

/** A tag is one word: it is written on the note's `tags:` line and typed as `#tag` in search. */
const clean = (v: string) => v.trim().replace(/^#/, "");
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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
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
            <div className="flex items-center gap-2">
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
            <div className="flex items-center justify-between gap-2">
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
      <h2 id="appearance-h" className="font-bold text-lg tracking-tight">Appearance</h2>
      <p className="text-sm text-dim">The theme and the primary colour are this browser's, as the phone keeps its own.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
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
  const loose = useMemo(() => undefinedTags(data ?? [], [...notes.map((n) => n.note.tags), ...tasks.map((t) => t.tags)]), [data, notes, tasks]);
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of n.note.tags) m.set(t.toLowerCase(), (m.get(t.toLowerCase()) ?? 0) + 1);
    return m;
  }, [notes]);

  const confirmDelete = async () => {
    if (!deleting) return;
    try { await remove.mutateAsync(deleting); } catch (e) { toast.error(message(e)); }
    setDeleting(undefined);
  };

  return (
    <section className="space-y-3" aria-labelledby="tags-h">
      <div className="flex items-center gap-2">
        <h2 id="tags-h" className="flex-1 font-bold text-lg tracking-tight">Tags</h2>
        <Button size="sm" className="rounded-full" onClick={() => setEditing(null)}><Plus /> Add tag</Button>
      </div>
      <p className="text-sm text-dim">A tag's colour paints its badge on every device. The description is what the AI reads to decide whether a note belongs.
        The server tags notes itself, about a minute after a save: every tag that likely fits goes on, and one you take off stays off.</p>
      {isPending ? <Skeleton className="h-16 rounded-xl" /> : isError ? <p className="text-sm text-down">The tags can't be loaded.</p>
        : data.length || loose.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {data.map((t) => (
              <li key={t.rec} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2"><TagBadge name={t.name} /><span className="text-xs tabular-nums text-faint">{used.get(t.name.toLowerCase()) ?? 0} notes</span></div>
                  {t.description ? <p className="text-[13px] leading-snug text-dim">{t.description}</p> : null}
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="text-dim" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 className="text-dim" /></Button>
              </li>
            ))}
            {loose.map((t) => (
              <li key={`loose:${t.name}`} className="flex items-start gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2"><TagBadge name={t.name} /><span className="text-xs tabular-nums text-faint">{t.count} {t.count === 1 ? "item" : "items"}</span></div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => { setDefining(t.name); setEditing(null); }}><Pencil className="text-dim" /></Button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-faint">No tags defined yet.</p>}


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
    <section className="space-y-3" aria-labelledby="agent-h">
      <h2 id="agent-h" className="font-bold text-lg tracking-tight">Agent</h2>
      <p className="text-sm text-dim">Ask answers from your notes and writes the ones you tell it to. The server holds the keys; the model and the switch below are this browser's.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Model</p></div>
          <ModelMenu />
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
  );
}

/** agent/memory.md: the agent's notes about the owner, which it rewrites itself. Shown, not edited here: it is the agent's record, not a note. */
function Memory() {
  const { data, isPending } = useQuery({ queryKey: ["memory"], queryFn: memory });
  return (
    <section className="space-y-3" aria-labelledby="memory-h">
      <h2 id="memory-h" className="font-bold text-lg tracking-tight">Agent memory</h2>
      <p className="text-sm text-dim">The agent (Ask, here and on the phone) keeps this file about you and how you keep notes, and rewrites it on its own.</p>
      <div className="rounded-xl border border-line px-4 py-3">
        {isPending ? <Skeleton className="h-24" /> : data?.text.trim() ? <Markdown body={data.text} /> : <p className="text-sm text-faint">Empty: the agent hasn't written anything yet.</p>}
      </div>
    </section>
  );
}

/** Every note and the photos and PDFs they link, as one zip: `notes/<file>.md` and `attachments/<note-id>/<name>`. */
function Export() {
  const { data, isPending } = useNotes();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!data) return;
    setBusy(true);
    try { toast(`Downloaded ${await downloadZip(data, `tefnotes-notes-${localDay()}.zip`)} notes`); } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3" aria-labelledby="export-h">
      <h2 id="export-h" className="font-bold text-lg tracking-tight">Export</h2>
      <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-dim">Every note as a markdown file, with the photos and PDFs they link, in one zip. A single note downloads from its own menu.</p>
        <Button variant="outline" className="rounded-full" disabled={isPending || busy || !data?.length} onClick={() => { void run(); }}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />} Download all notes
        </Button>
      </div>
    </section>
  );
}

/** A folder of Markdown, or an export's zip, in as notes: picked, checked without writing, then imported. */
function Import() {
  const [src, setSrc] = useState<{ name: string; source: Source; seen: ImportTally } | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = { url: location.origin };
  const pick = async (name: string, make: () => Promise<Source> | Source) => {
    setBusy(true);
    try {
      const source = await make();
      const seen = await importNotes(here, source, { dry: true, update: false, today: localDay() });
      if (!seen.found) { toast.error(`No markdown files in ${name}`); setSrc(null); } else setSrc({ name, source, seen });
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
  return (
    <section className="space-y-3" aria-labelledby="import-h">
      <h2 id="import-h" className="font-bold text-lg tracking-tight">Import</h2>
      <div className="space-y-3 rounded-xl border border-line px-3 py-2.5">
        <p className="text-[13px] leading-snug text-dim">Every markdown file in a folder, or in a zip such as Export makes, as a note; the photos and PDFs they link come along as attachments. Nothing is written until you confirm.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-full" disabled={busy}>
            <label>
              <Upload /> Choose folder
              <input type="file" className="sr-only" disabled={busy} {...{ webkitdirectory: "" }}
                onChange={(e) => { const f = files(e); if (f.length) void pick(f[0].webkitRelativePath.split("/")[0] || "the folder", () => folderSource(f)); }} />
            </label>
          </Button>
          <Button asChild variant="outline" className="rounded-full" disabled={busy}>
            <label>
              <Upload /> Choose zip
              <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy}
                onChange={(e) => { const [f] = files(e); if (f) void pick(f.name, () => zipSource(f)); }} />
            </label>
          </Button>
          {busy && <Loader2 className="size-4 animate-spin self-center text-dim" />}
        </div>
        {src && (
          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-sm"><span className="font-semibold">{src.name}</span>: {src.seen.found} notes, {src.seen.taken} already here.</p>
            {src.seen.taken > 0 && (
              <div className="flex items-center gap-2">
                <Switch id="import-update" checked={update} onCheckedChange={setUpdate} />
                <Label htmlFor="import-update" className="text-[13px] text-dim">Overwrite the {src.seen.taken} already here (otherwise they are skipped)</Label>
              </div>
            )}
            <div className="flex gap-2">
              <Button className="rounded-full" disabled={busy} onClick={() => { void run(); }}>Import {update ? src.seen.found : src.seen.found - src.seen.taken} notes</Button>
              <Button variant="ghost" className="rounded-full" disabled={busy} onClick={() => setSrc(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The sections, each its own page picked from the settings sidebar. */
const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette, body: Appearance },
  { id: "agent", label: "Agent", icon: Bot, body: Agent },
  { id: "memory", label: "Agent memory", icon: Brain, body: Memory },
  { id: "tags", label: "Tags", icon: TagIcon, body: Tags },
  { id: "import", label: "Import", icon: Upload, body: Import },
  { id: "export", label: "Export", icon: Download, body: Export },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPane() {
  const [at, setAt] = useState<SectionId>("appearance");
  const Body = SECTIONS.find((s) => s.id === at)?.body ?? Appearance;
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="w-52 shrink-0 space-y-1 border-r border-line px-3 pt-8">
        <div className="mb-3 flex items-center gap-2 px-2 text-brand"><Settings className="size-5" /><span className="text-xs font-semibold uppercase tracking-wider">Settings</span></div>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={id === at ? "page" : undefined} onClick={() => setAt(id)}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              id === at ? "bg-muted font-semibold text-fg" : "text-dim")}>
            <Icon className="size-4" />{label}
          </button>
        ))}
      </nav>
      <article className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-24 md:px-10"><Body /></div>
      </article>
    </div>
  );
}
