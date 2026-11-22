// Settings → Tags: the tag definitions (colour, description) and the tags in use without one; a row opens its dialog, where it is
// renamed, described or deleted.
import { Check, ChevronRight, Plus, Search, Sparkles, Tag as TagIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { COLORS, fold, type Color } from "@/core/notes";
import { Conflict } from "@/core/record-contracts";
import { undefinedTags, type TagDef } from "@/core/tags";
import { Empty } from "@/components/empty";
import { Loaded } from "@/components/loaded";
import { Group, Page, Pill } from "@/components/settings/kit";
import { TagBadge } from "@/components/tag-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTasks } from "@/hooks/todo";
import { useNotes } from "@/hooks/notes";
import { useCreateTag, useDescribeTag, useRemoveTag, useRenameTag, useTags, useUpdateTag } from "@/hooks/tags";
import { message } from "@/services/api";
import { cn } from "@/lib/utils";

/** A tag is one word: it is written on the note's `tags:` line and typed as `#tag` in search. */
const clean = (v: string) => v.trim().replace(/^#/, "");
const BAD = /[\s,[\]{}"\\]/;

/** `name`: a new tag's name to start from (one notes already carry). A changed name renames the tag on every item that
 *  carries it (the server's rename); one another tag already has merges the two, and the dialog says so before Save. */
function TagDialog({ tag, name: start, onClose, onDelete }: { tag: TagDef | null; name?: string; onClose: () => void; onDelete: (t: TagDef) => void }) {
  const [name, setName] = useState(tag?.name ?? start ?? ""), [color, setColor] = useState<Color | undefined>(tag?.color), [description, setDescription] = useState(tag?.description ?? "");
  const create = useCreateTag(), update = useUpdateTag(), rename = useRenameTag(), describe = useDescribeTag();
  const { data: defs = [] } = useTags();
  const n = clean(name), bad = BAD.test(n);
  const from = tag?.name ?? start, renaming = !!from && !!n && n !== from;
  const into = renaming ? defs.find((d) => d.rec !== tag?.rec && fold(d.name) === fold(n) && fold(d.name) !== fold(from)) : undefined;
  const busy = create.isPending || update.isPending || rename.isPending;
  const generate = () => describe.mutate(n, { onSuccess: setDescription, onError: (err) => toast.error(message(err)) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!n || bad) return;
    try {
      if (renaming) {
        const r = await rename.mutateAsync({ from, to: n });
        if (r.merged) { toast.success(`Merged “${from}” into “${r.tag}”.`); onClose(); return; }
        const fields = { name: r.tag, color, description };
        if (tag) await update.mutateAsync({ rec: tag.rec, fields }); else await create.mutateAsync(fields);
      } else {
        const fields = { name: n, color, description };
        if (tag) await update.mutateAsync({ rec: tag.rec, fields }); else await create.mutateAsync(fields);
      }
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
            <DialogDescription>{tag ? "A new name is renamed on every note, task and lens that carries it." : "A tag is one word, written on a note and typed as #tag in search."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name</Label>
            <Input id="tag-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="home" aria-invalid={bad} />
            {bad ? <p className="text-xs text-down">No spaces, commas, brackets or quotes.</p>
              : into ? <p className="text-xs text-dim">“{into.name}” is a tag already: saving merges “{from}” into it, keeping its colour and description.</p> : null}
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
              placeholder="What the AI reads to decide whether a note belongs." />
          </div>
          <DialogFooter>
            {tag ? <Button type="button" variant="ghost" className="mr-auto rounded-full text-down" onClick={() => onDelete(tag)}>Delete</Button> : null}
            <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="rounded-full" disabled={!n || bad || busy}>{into ? "Merge" : tag ? "Save" : "Add tag"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Tags() {
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

  const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
  return (
    <Page title="Tags" action={<Button size="sm" className="rounded-full" onClick={() => setEditing(null)}><Plus /> Add tag</Button>}>
      {data?.length || loose.length ? (
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags" aria-label="Search tags" />
        </InputGroup>
      ) : null}
      <Loaded loading={isPending} blurred={false} skeleton={<Skeleton className="h-16 rounded-xl" />}>
      {isError ? <p className="text-sm text-down">The tags can't be loaded.</p>
        : defs.length || looseShown.length ? (
          <>
            {defs.length ? (
              <Group title="Defined">
                <ul className="divide-y divide-line">
                  {defs.map((t) => (
                    <li key={t.rec}>
                      <button type="button" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted">
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex items-center gap-2"><TagBadge name={t.name} /><Pill>{items(count(t.name))}</Pill></span>
                          {t.description ? <span className="line-clamp-2 text-xs leading-snug text-dim">{t.description}</span> : null}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            ) : null}
            {looseShown.length ? (
              <Group title="Used, not defined" hint="Define one to give it a colour and a description.">
                <ul className="divide-y divide-line">
                  {looseShown.map((t) => (
                    <li key={`loose:${t.name}`}>
                      <button type="button" aria-label={`Define ${t.name}`} onClick={() => { setDefining(t.name); setEditing(null); }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted">
                        <span className="flex min-w-0 flex-1 items-center gap-2"><TagBadge name={t.name} /><Pill>{items(t.count)}</Pill></span>
                        <Plus className="size-4 shrink-0 text-brand" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            ) : null}
          </>
        ) : <Empty icon={TagIcon} className="rounded-xl border border-dashed border-line px-3 py-8"><p className="text-sm text-faint">{find ? `No tag matches “${find}”.` : "No tags defined yet."}</p></Empty>}
      </Loaded>
      {editing !== undefined ? <TagDialog key={editing?.rec ?? `new:${defining ?? ""}`} tag={editing} name={defining}
        onClose={() => { setEditing(undefined); setDefining(undefined); }} onDelete={(t) => { setEditing(undefined); setDeleting(t); }} /> : null}
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
    </Page>
  );
}
