// The open note, edited as it reads (src/editor: boxes tick in place, photos show), on the page note-page.tsx gives it. The raw
// markdown, which is what the phone edits, is one toggle away (in ⋮). The title is editable in place, and a note just made
// ("Untitled", empty) opens with it selected, ready to be typed over; pin, colour and tags are one click
// each, written as the frontmatter edit the phone makes (withFlags). One top bar holds every tool and option of the
// note: the format tools, attach, pin and ⋮. A note is pure markdown: tasks are records of their own (task-detail.tsx), and those linked to it show under its title.
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, EllipsisVertical, FileCode, FileUp, Paperclip, Link2, Loader2, PenTool, Pin, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { DrawingDialog } from "@/components/drawing-dialog";
import { FormatTools } from "@/components/format-tools";
import { MicButton } from "@/components/mic-button";
import { LinkedTasks } from "@/components/linked-tasks";
import { Turns } from "@/components/swap";
import { COLORS, UNTITLED } from "@/core/notes";
import { applyTags } from "@/core/tags";
import { ago } from "@/core/time";
import { NoteEditor, type NoteEditorHandle } from "@/components/note-editor";
import { TagEditor } from "@/components/tag-editor";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Editor } from "@/editor";
import { dictateInto } from "@/hooks/dictation";
import { useDraft, type Status } from "@/hooks/draft";
import { deleteNote, NOTES, setFlags, write, type FlagEdit } from "@/hooks/notes";
import { useNoteOut } from "@/hooks/note-out";
import { useNow } from "@/hooks/now";
import { attachable, useAddFiles } from "@/hooks/photos";
import { useNav } from "@/lib/nav";
import { ms } from "@/lib/search";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";
import type { NoteRec } from "@/services/notes";

function IconButton({ label, children, ...p }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} {...p}>{children}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The save state, one line each: the box is as wide as the widest, and one swaps for the next in place (swap.tsx). */
const STATUS: Record<Status, ReactNode> = {
  saved: <span className="inline-flex items-center gap-1.5 text-faint"><Check className="size-3" />Saved</span>,
  unsaved: <span className="text-faint">Editing…</span>,
  saving: <span className="inline-flex items-center gap-1.5 text-faint"><Loader2 className="size-3 animate-spin" />Saving…</span>,
  error: <span className="inline-flex items-center gap-1.5 text-down"><TriangleAlert className="size-3" />Not saved</span>,
};

export function NotePane({ n, leading, onNote, onGone }: { n: NoteRec; leading?: React.ReactNode; onNote: (id: string) => void; onGone: () => void }) {
  const qc = useQueryClient();
  const d = useDraft(n);
  const { filterTag } = useNav();
  const now = useNow(30_000);
  const [raw, setRaw] = useState(false);
  const [ed, setEd] = useState<Editor | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState<{ name: string | null } | null>(null);     // the drawing dialog: a file to edit, or a new one
  const title = useRef<HTMLInputElement>(null), area = useRef<HTMLTextAreaElement>(null), file = useRef<HTMLInputElement>(null), editor = useRef<NoteEditorHandle>(null);
  const addFiles = useAddFiles(n.note.id);
  const note = n.note;

  const fresh = () => qc.getQueryData<NoteRec[]>(NOTES)?.find((x) => x.path === n.path) ?? n;
  const flag = async (f: FlagEdit) => {
    try { await d.flush(); await setFlags(qc, fresh(), f); } catch (e) { toast.error(message(e)); }
  };

  /** A tag put on or taken off: written like any edit, at the note's rev. */
  const retag = async (add: string[], remove: string[] = []) => {
    try { await d.flush(); await write(qc, fresh(), (text) => applyTags(n.path, text, add, remove)); } catch (e) { toast.error(message(e)); }
  };

  /** Lines of markdown (files already uploaded) into the body at the cursor: one to a paragraph in the editor. */
  const place = (md: string) => {
    const el = area.current;
    if (!raw || !el) { editor.current?.insertMarkdown(md.split("\n").join("\n\n")); return; }
    const at = el.selectionStart, before = d.body.slice(0, at), after = d.body.slice(at);
    const pad = (s: string) => (s && !s.endsWith("\n\n") ? (s.endsWith("\n") ? "\n" : "\n\n") : "");
    d.setBody(`${before}${pad(before)}${md}\n${after.startsWith("\n") || !after ? "" : "\n"}${after}`);
    void d.flush();
  };

  /** Photos and PDFs into the body at the cursor, uploaded first: a body never points at nothing. */
  const attach = async (files: File[]) => {
    if (!files.some(attachable)) return;
    setUploading(true);
    try {
      const md = await addFiles(files);
      if (md) place(md);
    } catch (e) { toast.error(message(e)); } finally { setUploading(false); }
  };

  /** The note as saved just now (an edit still waiting for its save goes first), given to the agent or downloaded. */
  const out = useNoteOut();
  const sendOut = async (what: "ask" | "save") => {
    try { await d.flush(); } catch (e) { toast.error(message(e)); return; }
    await out[what]([fresh()]);
  };

  const remove = async () => {
    try { await deleteNote(qc, fresh()); toast(`Deleted “${note.title}”`); onGone(); } catch (e) { toast.error(message(e)); }
  };

  // A note just made, opened: the title selected, to type over (once: the pane is keyed by the note)
  const [untouched] = useState(() => n.note.title === UNTITLED && !n.note.body.trim());
  useEffect(() => {
    if (!untouched) return;
    title.current?.focus();
    title.current?.select();
  }, [untouched]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void d.flush(); } };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  const source = (
    <textarea ref={area} value={d.body} onChange={(e) => d.setBody(e.target.value)} spellCheck
      onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); void attach(f); } }}
      placeholder="Write in markdown…" aria-label="Note body (markdown)"
      className="h-full min-h-[50vh] w-full resize-none bg-transparent font-mono text-[13px] leading-[1.6] outline-none placeholder:text-faint" />
  );

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={note.title}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { const f = [...e.dataTransfer.files]; if (f.length) { e.preventDefault(); void attach(f); } }}>
      <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 md:px-4">
        {leading}
        {raw || !ed ? null : <FormatTools editor={ed} />}
        <Turns className={cn("ml-2 shrink-0 place-items-start text-xs", d.status !== "error" && "max-sm:hidden")} aria-live="polite" state={d.status} states={STATUS} />
        <div className="flex-1" />
        {uploading ? <Loader2 className="mr-1 size-4 animate-spin text-dim" /> : null}
        <MicButton variant="bar" onText={(t) => { if (raw || !ed) dictateInto(area.current, d.body, t, d.setBody); else ed.insertText(t); }} />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Attach or draw"><Paperclip className="text-dim" /></Button></DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Attach or draw</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => file.current?.click()}><FileUp /> Photo or PDF…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDrawing({ name: null })}><PenTool /> New drawing</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={file} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <IconButton label={note.pinned ? "Unpin" : "Pin to top"} aria-pressed={note.pinned} onClick={() => flag({ pinned: !note.pinned })}>
          <Pin className={note.pinned ? "fill-fg text-fg" : "text-dim"} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><EllipsisVertical className="text-dim" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-faint text-xs">Colour</DropdownMenuLabel>
            <div className="flex gap-1.5 px-2 pb-2">
              {COLORS.map((c) => (
                <button key={c} type="button" data-color={c} aria-label={c} aria-pressed={note.color === c}
                  onClick={() => flag({ color: note.color === c ? null : c })}
                  className={cn("size-6 rounded-full border-2 bg-tile", note.color === c ? "border-tile-fg" : "border-tile-line")} />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={raw} onCheckedChange={setRaw}><FileCode /> Markdown source</DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(`${location.origin}/note/${encodeURIComponent(note.id)}`); toast("Link copied"); }}>
              <Link2 /> Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { void sendOut("ask"); }}><Sparkles /> Ask about this note</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { void sendOut("save"); }}><Download /> {out.verb} .md</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-24 md:px-10">
          <input ref={title} value={d.title} onChange={(e) => d.setTitle(e.target.value)} aria-label="Title" placeholder="Title"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (raw) area.current?.focus(); else editor.current?.focus("start"); } }}
            className="w-full bg-transparent font-extrabold text-3xl tracking-tight outline-none placeholder:text-faint" />
          <div className="mt-2 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-faint">
            <span className="tabular-nums">{note.created}</span>
            <span className="tabular-nums">edited {ago(ms(n.updated), now)}</span>
            <TagEditor tags={note.tags} onAdd={(t) => void retag([t])} onRemove={(t) => void retag([], [t])} onTag={filterTag} />
          </div>
          <LinkedTasks n={n} className="mb-6" />
          {raw ? source : (
            <NoteEditor ref={editor} key={note.id} noteId={note.id} markdown={d.body} onChange={d.setBody} onFiles={(f) => void attach(f)} onNote={onNote} onDrawing={(name) => setDrawing({ name })} onEditor={setEd} />
          )}
        </div>
      </div>

      <DrawingDialog noteId={note.id} name={drawing?.name ?? null} open={drawing !== null} onClose={() => setDrawing(null)} onCreated={place} />

      <AlertDialog open={!!d.clash}>
        <AlertDialogContent className="sm:max-w-4xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Edited on another device too</AlertDialogTitle>
            <AlertDialogDescription>Both changed the same lines, so nothing was written. Keep one side; the other is lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-hidden">
            {(["mine", "theirs"] as const).map((k) => (
              <div key={k} className="flex min-h-0 flex-col gap-1.5">
                <p className="text-xs font-semibold text-dim">{k === "mine" ? "Yours, here" : "Theirs, on the server"}</p>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 font-mono text-xs">{d.clash?.[k]}</pre>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => d.resolve("theirs")}>Keep theirs</AlertDialogCancel>
            <AlertDialogAction onClick={() => d.resolve("mine")}>Keep mine</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{note.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The note and its photos go from every device. There is no undo and no backup.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
