// What the list does to notes without opening them: a tile's ⋮ menu and the bar a selection turns the header into.
// Both act on `paths` (one note, or the selection) through useBulk, so one note and many go the same way. The
// tags and delete dialogs are the list's, opened from either; asking the agent and downloading need none.
import { Download, EllipsisVertical, Palette, Pin, Sparkles, Tag, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { colorPatch, pinPatch, tagState, tagUnion } from "@/core/bulk";
import { COLORS, type Color } from "@/core/notes";
import { TagEditor } from "@/components/tag-editor";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBulk } from "@/hooks/bulk";
import { useNotes } from "@/hooks/notes";
import { useNoteOut } from "@/hooks/note-out";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";

/** The notes at `paths`, live, in the cache's order. */
function useTargets(paths: string[]): NoteRec[] {
  const { data } = useNotes();
  return useMemo(() => (data ?? []).filter((n) => paths.includes(n.path)), [data, paths]);
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();       // a portal's events bubble to the tile under it

/** The six tile tints; `value` is ringed, and picking it again takes the tint off (`onPick(null)`). */
/** The colour swatches: they wrap in a narrow menu, never squeeze. */
export function Swatches({ value, onPick }: { value?: Color; onPick: (c: Color | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-2">
      {COLORS.map((c) => (
        <button key={c} type="button" data-color={c} aria-label={c} aria-pressed={value === c} onClick={() => onPick(value === c ? null : c)}
          className={cn("size-6 shrink-0 rounded-full border-2 bg-tile", value === c ? "border-tile-fg" : "border-tile-line")} />
      ))}
    </div>
  );
}

/** A colour is the tile's tint in the list; one note's own is ringed. */
function useFlagActions(paths: string[]) {
  const recs = useTargets(paths), bulk = useBulk();
  const notes = recs.map((r) => r.note);
  const color = recs.length === 1 ? notes[0].color : undefined;
  return {
    pinned: notes.length > 0 && notes.every((n) => n.pinned), color,
    pin: () => bulk.flags(paths, pinPatch(notes)), paint: (c: Color | null) => bulk.flags(paths, colorPatch(c)),
  };
}

/** The tile's ⋮ (and a right-click): pin, colour, tags, ask the agent, download, delete. */
export function TileMenu({ paths, open, onOpenChange, onTags, onDelete, className }: {
  paths: string[]; open: boolean; onOpenChange: (o: boolean) => void; onTags: () => void; onDelete: () => void; className?: string;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Note actions" onClick={stop} className={className}><EllipsisVertical className="size-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={stop} onKeyDown={stop}>
        <MenuItems paths={paths} onTags={onTags} onDelete={onDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same menu opened at a point, for a right-click on a row that has no ⋮ of its own (the search palette's notes). */
export function MenuAt({ paths, at, onClose, onTags, onDelete }: {
  paths: string[]; at: { x: number; y: number } | null; onClose: () => void; onTags: () => void; onDelete: () => void;
}) {
  return (
    <DropdownMenu open={at !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={at ? { left: at.x, top: at.y } : undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" onClick={stop} onKeyDown={stop}>
        <MenuItems paths={paths} onTags={onTags} onDelete={onDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hand the notes to the agent, or download them: the same two for one note and for a selection. */
function OutItems({ paths }: { paths: string[] }) {
  const recs = useTargets(paths), out = useNoteOut(), many = recs.length > 1;
  return (
    <>
      <DropdownMenuItem onSelect={() => out.ask(recs)}><Sparkles /> {many ? "Ask about these" : "Ask about this note"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void out.save(recs); }}><Download /> {out.verb} {many ? (out.verb === "Share" ? ".md files" : ".zip") : ".md"}</DropdownMenuItem>
    </>
  );
}

function MenuItems({ paths, onTags, onDelete }: { paths: string[]; onTags: () => void; onDelete: () => void }) {
  const f = useFlagActions(paths);
  return (
    <>
      <DropdownMenuItem onSelect={f.pin}><Pin /> {f.pinned ? "Unpin" : "Pin to top"}</DropdownMenuItem>
      <DropdownMenuLabel className="text-faint text-xs">Colour</DropdownMenuLabel>
      <Swatches value={f.color} onPick={f.paint} />
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onTags}><Tag /> Tags…</DropdownMenuItem>
      <OutItems paths={paths} />
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 /> Delete</DropdownMenuItem>
    </>
  );
}

/** The list's header while notes are selected: a count, select all, and the same actions for every one of them. */
export function BulkBar({ paths, onClear, onAll, onTags, onDelete }: { paths: string[]; onClear: () => void; onAll: () => void; onTags: () => void; onDelete: () => void }) {
  const f = useFlagActions(paths);
  return (
    <div className="flex min-h-8 items-center gap-0.5" role="toolbar" aria-label="Selected notes">
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}><X /></Button>
      <button type="button" onClick={onAll} title="Select every note in the list" className="mr-auto rounded px-1.5 font-semibold text-sm hover:bg-muted">
        {paths.length} selected
      </button>
      <Button variant="ghost" size="icon-sm" aria-label={f.pinned ? "Unpin" : "Pin to top"} aria-pressed={f.pinned} title={f.pinned ? "Unpin" : "Pin to top"} onClick={f.pin}>
        <Pin className={f.pinned ? "fill-fg" : "text-dim"} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Colour" title="Colour"><Palette className="text-dim" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><Swatches value={f.color} onPick={f.paint} /></DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-sm" aria-label="Tags" title="Tags" onClick={onTags}><Tag className="text-dim" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete" onClick={onDelete}><Trash2 className="text-down" /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More" title="More"><EllipsisVertical className="text-dim" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><OutItems paths={paths} /></DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Tags for the notes at `paths`: the union of theirs (dashed where only some carry it), adding to and removing from all. */
export function TagsDialog({ paths, open, onOpenChange }: { paths: string[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const recs = useTargets(paths), bulk = useBulk();
  const lists = recs.map((r) => r.note.tags), tags = tagUnion(lists);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{recs.length === 1 ? `Tags: ${recs[0].note.title}` : `Tags for ${recs.length} notes`}</DialogTitle>
          <DialogDescription>{recs.length > 1 ? "Dashed tags are on some of them. Adding puts a tag on all; removing takes it off all." : "Add or remove tags on this note."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          <TagEditor tags={tags} dim={tags.filter((t) => tagState(lists, t) !== "all")}
            onAdd={(t) => void bulk.tags(paths, [t])} onRemove={(t) => void bulk.tags(paths, [], [t])} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One confirm for the delete of the notes at `paths`; `onDone` after they're gone. */
export function DeleteDialog({ paths, open, onOpenChange, onDone }: { paths: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const recs = useTargets(paths), bulk = useBulk();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{recs.length === 1 ? `Delete “${recs[0].note.title}”?` : `Delete ${recs.length} notes?`}</AlertDialogTitle>
          <AlertDialogDescription>{recs.length === 1 ? "The note and its photos go" : "The notes and their photos go"} from every device. There is no undo and no backup.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { void bulk.remove(paths).then(onDone); }}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
