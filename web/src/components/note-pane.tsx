// The open note, edited as it reads (src/editor: boxes tick in place, photos show), on the page note-page.tsx gives it. Its markdown
// is one tap from the clipboard (Copy markdown). The title is editable in place, and a note just made
// ("Untitled", empty) opens with it selected, ready to be typed over; pin, colour and tags are
// one click each, written as the frontmatter edit the phone makes (withFlags). One top bar holds every tool and option of the
// note: the format tools, attach, pin and ⋮. A note is pure markdown: tasks are records of their own (task-detail.tsx), and those linked to it show under its title.
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DrawingLayer } from "@/components/drawing-layer";
import { FormatTools } from "@/components/format-tools";
import { ClashDialog, DeleteNoteDialog } from "@/components/note-dialogs";
import { NoteHeaderActions } from "@/components/note-header";
import { useNoteRunActions } from "@/components/note-pane-run";
import { NoteRunPanel, RunSheen } from "@/components/note-run";
import { MicButton } from "@/components/mic-button";
import { ContentsRail } from "@/components/note-contents";
import { LinkedTasks } from "@/components/linked-tasks";
import { SaveMark } from "@/components/save-mark";
import { archivePatch } from "@/core/bulk";
import { UNTITLED, pastedNote, type FlagEdit } from "@/core/notes";
import { applyTags } from "@/core/tags";
import { ago } from "@/core/days";
import { NoteEditor, type NoteEditorHandle } from "@/components/note-editor";
import { SelectionBar } from "@/components/selection-bar";
import { TagEditor } from "@/components/tag-editor";
import type { Editor } from "@/editor";
import { useContents } from "@/hooks/contents";
import { openDrawing, useOpened } from "@/hooks/drawing";
import { useDraft } from "@/hooks/draft";
import { deleteNote, NOTES, setFlags, write } from "@/hooks/notes";
import { useNoteOut } from "@/hooks/note-out";
import { useKeyboard } from "@/hooks/keyboard";
import { useNarrow } from "@/hooks/media";
import { useNow } from "@/hooks/now";
import { attachable, useAddFiles } from "@/hooks/photos";
import { noteHref, useNav } from "@/lib/nav";
import { ms } from "@/lib/search";
import { noteScroll } from "@/lib/scroll";
import { message } from "@/services/api";
import type { NoteRec } from "@/services/notes";

export function NotePane({ n, leading, onNote, onGone }: { n: NoteRec; leading?: React.ReactNode; onNote: (id: string) => void; onGone: () => void }) {
  const qc = useQueryClient();
  const d = useDraft(n);
  const { filterTag } = useNav();
  const now = useNow(30_000);
  const [ed, setEd] = useState<Editor | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const drawing = useOpened(n.note.id);     // the drawing open over the note, the owner's or the agent's (hooks/drawing.ts)
  const scroller = useRef<HTMLDivElement>(null);
  const contents = useContents(ed, scroller);     // the headings, for the rail beside the text
  const title = useRef<HTMLTextAreaElement>(null), file = useRef<HTMLInputElement>(null), editor = useRef<NoteEditorHandle>(null);
  const addFiles = useAddFiles(n.path);
  const note = n.note;

  const fresh = () => qc.getQueryData<NoteRec[]>(NOTES)?.find((x) => x.rec === n.rec) ?? n;
  const flag = async (f: FlagEdit) => {
    try { await d.flush(); await setFlags(n, f); } catch (e) { toast.error(message(e)); }
  };

  /** A tag put on or taken off: written like any edit, at the note's rev. */
  const retag = async (add: string[], remove: string[] = []) => {
    try { await d.flush(); await write(n, (text, path) => applyTags(path, text, add, remove)); } catch (e) { toast.error(message(e)); }
  };

  /** Lines of markdown (files already uploaded) into the body at the cursor: one to a paragraph in the editor. */
  const place = (md: string) => { editor.current?.insertMarkdown(md.split("\n").join("\n\n")); };

  /** Photos and PDFs into the body at the cursor, uploaded first: a body never points at nothing. */
  const attach = async (files: File[]) => {
    if (!files.some(attachable)) return;
    setUploading(true);
    try {
      await d.flush();
      const { lines } = await addFiles(files);
      if (lines) place(lines);
    } catch (e) { toast.error(message(e)); } finally { setUploading(false); }
  };

  /** The note as saved just now (an edit still waiting for its save goes first), given to the agent or downloaded. */
  const out = useNoteOut();
  const sendOut = async (what: "ask" | "save") => {
    try { await d.flush(); } catch (e) { toast.error(message(e)); return; }
    await out[what]([fresh()]);
  };

  const { runs, running, runAction, ran } = useNoteRunActions(n, d.flush, fresh);

  const remove = async () => {
    try { await deleteNote(n); toast(`Deleted “${note.title}”`); onGone(); } catch (e) { toast.error(message(e)); }
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

  // On a phone the format tools ride on top of the keyboard (the viewport resizes with it, index.html), not in the top bar
  const narrow = useNarrow(), keyboard = useKeyboard();
  const tools = !ed ? null : <FormatTools editor={ed} side={narrow ? "top" : "bottom"} />;

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={note.title}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { const f = [...e.dataTransfer.files]; if (f.length) { e.preventDefault(); void attach(f); } }}>
      <header className="@container flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 md:px-4">
        {leading}
        {narrow ? null : tools}
        <div className="flex-1" />
        {uploading ? <Loader2 className="mr-1 size-4 animate-spin text-dim" /> : null}
        <MicButton variant="bar" onText={(t) => ed?.insertText(t)} />
        <input ref={file} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <NoteHeaderActions pinned={!!note.pinned} archived={!!note.archived} color={note.color} saveVerb={out.verb} running={running ? runs.run?.meta.action.id ?? null : null}
          onFile={() => file.current?.click()} onDraw={() => { void openDrawing(note.id, null); }} onPin={() => { void flag({ pinned: !note.pinned }); }}
          onAsk={() => { void sendOut("ask"); }} onSave={() => { void sendOut("save"); }} onColor={(color) => { void flag({ color }); }}
          onCopyMarkdown={() => { void navigator.clipboard.writeText(d.body).then(() => toast("Markdown copied")); }}
          onCopyLink={() => { void navigator.clipboard.writeText(location.origin + noteHref(note.id)); toast("Link copied"); }}
          onArchive={() => { void flag(archivePatch([note])).then(() => toast(note.archived ? "Brought back from the archive" : "Archived")); }}
          onDelete={() => setConfirm(true)} onRun={(a) => { void runAction(a); }} />
      </header>

      <div className="relative min-h-0 flex-1">
      <RunSheen on={running} />
      <NoteRunPanel run={runs.run} onClose={runs.close} onCarry={runs.carry} onAgain={() => { if (runs.run) void runAction(runs.run.meta.action); }} onWrote={ran} />
      <div ref={scroller} data-scroll-restoration-id={noteScroll(note.id)} className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-24 md:px-10">
          <textarea ref={title} rows={1} value={d.title} onChange={(e) => d.setTitle(e.target.value.replace(/\s*\n\s*/g, " "))}
            onPaste={(e) => {
              // Markdown pasted into an empty note's title: the first line its title, the rest its body, as written
              const split = d.body.trim() ? null : pastedNote(e.clipboardData.getData("text/plain"));
              if (!split) return;
              e.preventDefault();
              d.setTitle(split.title);
              d.setBody(split.body);
              void d.flush();
            }}
            aria-label="Title" placeholder="Title"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.current?.focus("start"); } }}
            className="field-sizing-content block w-full resize-none break-words bg-transparent font-extrabold text-3xl leading-tight tracking-tight outline-none placeholder:text-faint" />
          <div className="mt-2 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-faint">
            {note.archived ? <span className="flex items-center gap-1"><Archive className="size-3" /> Archived</span> : null}
            <span className="tabular-nums">{note.created}</span>
            <span className="tabular-nums">edited {ago(ms(n.updated), now)}</span>
            <TagEditor tags={note.tags} onAdd={(t) => void retag([t])} onRemove={(t) => void retag([], [t])} onTag={filterTag} />
          </div>
          <LinkedTasks n={n} className="mb-6" />
          <NoteEditor ref={editor} key={note.id} noteId={note.id} markdown={d.body} onChange={d.setBody} onTainted={d.taint} onFiles={(f) => void attach(f)} onNote={onNote} onDrawing={(name) => { void openDrawing(note.id, name); }} onEditor={setEd} />
          {ed ? <SelectionBar editor={ed} /> : null}
        </div>
      </div>
      <ContentsRail contents={contents} />
      <SaveMark status={d.status} className="absolute bottom-3 left-3 md:bottom-4 md:left-4" />
      </div>

      {narrow && keyboard && tools ? (
        <div className="flex h-11 shrink-0 items-center overflow-x-auto border-t border-line bg-bg px-2">{tools}</div>
      ) : null}

      {drawing ? <DrawingLayer key={drawing.seq} opened={drawing} onCreated={place} /> : null}

      <ClashDialog clash={d.clash} onResolve={(keep) => { void d.resolve(keep); }} />
      <DeleteNoteDialog open={confirm} onOpenChange={setConfirm} title={note.title} onDelete={remove} />
    </article>
  );
}
