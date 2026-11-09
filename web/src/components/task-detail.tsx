// The open task, as Things' card: its title and notes, a checklist, and each thing it can say about itself in a row of
// its own: When, deadline, repeat, reminder, tags, where (where-card.tsx), the notes it is about. Every change is one field
// written at the task's rev (hooks/todo.ts), redone on the newer record when it moved; the notes are links (hooks/links.ts),
// outside the rev. Below `md` the card is a bottom sheet over its list (the shadcn drawer), as the phone opens a task, and
// its pickers (components/pick.tsx) are sheets over it.
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Calendar, ChevronDown, Flag, MapPin, Menu, Moon, NotebookText, Plus, Repeat, Tag, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { dayLabel, whenLabel } from "@/core/dates";
import { readsAsMarkdown, withLineBreaks } from "@/core/task-notes";
import { retagTask } from "@/core/todo";
import { chip, Clear, RemindPicker, RepeatPicker, Row } from "@/components/task-fields";
import { Checklist } from "@/components/checklist";
import { DraftTextarea } from "@/components/draft-field";
import { Markdown } from "@/components/markdown";
import { TagEditor } from "@/components/tag-editor";
import { InSheet, Pick } from "@/components/pick";
import { WhenPick } from "@/components/when-picker";
import { DeleteTask } from "@/components/task-delete";
import { PlacePick, WhereCard } from "@/components/where-card";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { TickBox } from "@/components/tick-box";
import { toggleTask, useLingering } from "@/hooks/linger";
import { useNarrow } from "@/hooks/media";
import { addLink, removeLink, useLinks } from "@/hooks/links";
import { useLensSorted, useSorted } from "@/hooks/notes";
import { changeTask, editTask, useToday } from "@/hooks/todo";
import { linkedNoteIds, notesFor } from "@/lib/links";
import { useNav } from "@/lib/nav";
import { report } from "@/lib/report";
import { whenState, scheduleOf } from "@/lib/schedule";
import { taskScroll } from "@/lib/scroll";
import { matches } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

/** A note the task is about, as a chip: its title (opens the note); its X removes the link, never the note. */
function LinkedNote({ n, onOpen, onRemove }: { n: NoteRec; onOpen: () => void; onRemove: () => void }) {
  return (
    <span className={cn(chip, "min-w-0 pr-1")}>
      <button type="button" className="inline-flex min-w-0 items-center gap-1.5" onClick={onOpen} title="Open the note">
        <span className="truncate">{n.note.title}</span>
      </button>
      <button type="button" aria-label={`Unlink ${n.note.title}`} title="Unlink" onClick={onRemove} className="grid size-5 shrink-0 place-items-center rounded-full text-faint hover:text-fg"><X className="size-3.5" /></button>
    </span>
  );
}

/** The notes the task is about: links of their own (core/record-links.ts), as many as it likes, added from a picker and
 *  removed one by one. Neither the task's nor the note's rev moves. */
function LinkedNotes({ task }: { task: TaskRec }) {
  const qc = useQueryClient();
  const sorted = useSorted(), scoped = useLensSorted(), links = useLinks().data;
  const { openNote } = useNav();
  const [open, setOpen] = useState(false), [q, setQ] = useState("");
  const { linked, unseen } = useMemo(() => notesFor(links ?? [], task.id, sorted), [links, task.id, sorted]);
  const taken = useMemo(() => linkedNoteIds(links ?? [], task.id), [links, task.id]);
  const hits = useMemo(() => scoped.filter((n) => n.rec && !taken.has(n.rec)).filter(matches(q)).slice(0, 30), [scoped, taken, q]);
  const add = (n: NoteRec) => { setOpen(false); setQ(""); report(addLink(qc, { type: "task", id: task.id }, { type: "note", id: n.rec }, "about")); };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
      {linked.map(({ link, n }) => (
        <LinkedNote key={link.id} n={n} onOpen={() => openNote(n.note.id)}
          onRemove={() => report(removeLink(qc, link.id))} />
      ))}
      {unseen ? <span className="text-sm text-faint">{unseen === 1 ? "A note you can't see yet" : `${unseen} notes you can't see yet`}</span> : null}
      <Pick title="Link a note" width="w-72 p-0" open={open} onOpenChange={setOpen}
        trigger={<button type="button" className={cn(chip, "text-faint")} aria-label="Link a note"><Plus className="size-3.5" />{linked.length || unseen ? "Add" : "None"}</button>}>
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Find a note…" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup>
              {hits.map((n) => <CommandItem key={n.path} value={n.path} onSelect={() => add(n)}>{n.note.title}</CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </Pick>
    </div>
  );
}

/** The task's tags: one more tag, or one fewer, is written at the task's rev and
 *  redone on the newer record when it moved (so a tag the auto-tagger or another device added meanwhile stays). */
function TaskTags({ task }: { task: TaskRec }) {
  const qc = useQueryClient();
  const retag = (add: string[], remove: string[] = []) => report(changeTask(qc, task.id, (t) => retagTask(t, add, remove)));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
      <TagEditor tags={task.tags} onAdd={(t) => retag([t])} onRemove={(t) => retag([], [t])} />
    </div>
  );
}

/** A task's notes: a text box, but read as markdown once they hold any (a link, emphasis, a list, a picture), each typed line kept, a click bringing the box back and leaving it the read view, as on the phone. */
function TaskNotes({ task, onSave }: { task: TaskRec; onSave: (notes: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  if (editing || !readsAsMarkdown(task.notes)) {
    return (
      <div onBlur={() => setEditing(false)}>
        <DraftTextarea dictate value={task.notes} aria-label="Notes" placeholder="Notes" onSave={onSave} autoFocus={editing} onFocus={() => setEditing(true)}
          className="min-h-16 resize-none border-transparent bg-transparent px-2 text-sm shadow-none hover:border-input dark:bg-transparent" />
      </div>
    );
  }
  return (
    <div role="button" tabIndex={0} aria-label="Edit the notes" className="cursor-text rounded-md border border-transparent px-2 py-1 text-sm hover:border-input"
      onClick={() => setEditing(true)} onKeyDown={(e) => { if (e.key === "Enter") setEditing(true); }}>
      <Markdown body={withLineBreaks(task.notes)} />
    </div>
  );
}

export function TaskDetail({ task, leading, onGone }: { task: TaskRec; leading?: React.ReactNode; onGone: () => void }) {
  const qc = useQueryClient();
  const today = useToday();
  const narrow = useNarrow(), { closeTask } = useNav();
  const lingering = useLingering();
  const [confirm, setConfirm] = useState(false);
  const checked = lingering.get(task.id)?.checked ?? !!task.done;
  const when = whenLabel(task, today);
  const patch = (p: Parameters<typeof editTask>[2]) => report(editTask(qc, task.id, p));

  const card = (
    <article className="flex h-full min-h-0 flex-col" aria-label={task.title}>
      <header className="flex h-11 shrink-0 items-center gap-1 px-2 md:h-12 md:border-b md:border-line md:px-4">
        {leading}
        <div className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Delete the task" title="Delete" onClick={() => setConfirm(true)} className="text-dim hover:text-destructive"><Trash2 /></Button>
      </header>

      <div data-scroll-restoration-id={taskScroll(task.id)} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl space-y-4 px-4 pt-2 pb-24 md:space-y-5 md:px-10 md:pt-8">
          <div className="flex items-start gap-3">
            <TickBox size="lg" checked={checked} aria-label={checked ? "Mark not done" : "Mark done"} onClick={() => { void toggleTask(qc, task); }} className="mt-1.5 shrink-0" />
            <DraftTextarea value={task.title} rows={1} aria-label="Title" placeholder="Title" onSave={(title) => editTask(qc, task.id, { title: title.replace(/\s*\n\s*/g, " ") })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              className={cn("min-h-0 resize-none border-transparent bg-transparent px-2 py-1 text-2xl leading-tight font-extrabold tracking-tight shadow-none hover:border-input md:text-2xl dark:bg-transparent", checked && "text-faint line-through decoration-faint")} />
          </div>
          {task.done ? <p className="-mt-3 pl-11 text-xs text-dim">Done {dayLabel(task.done, today)}</p> : null}

          <TaskNotes key={task.id} task={task} onSave={(notes) => editTask(qc, task.id, { notes })} />

          <Checklist task={task} />

          <div className="space-y-0.5 border-t border-line pt-3">
            <Row icon={task.evening ? Moon : Calendar} label="When">
              <WhenPick align="start" value={whenState(task)} today={today} onSchedule={(s) => patch(scheduleOf(s))} onDue={(d) => patch({ due: d ?? "" })}>
                <button type="button" className={cn(chip, !when && "text-faint")}>{when ?? "No date"}</button>
              </WhenPick>
              {when ? <Clear label="Clear the date" onClick={() => patch(scheduleOf(null))} /> : null}
            </Row>
            <Row icon={Flag} label="Deadline">
              <WhenPick align="start" value={whenState(task)} today={today} onSchedule={(s) => patch(scheduleOf(s))} onDue={(d) => patch({ due: d ?? "" })}>
                <button type="button" className={cn(chip, task.due ? (task.due < today ? "font-semibold text-warn" : "text-warn") : "text-faint")}>{task.due ? dayLabel(task.due, today) : "None"}</button>
              </WhenPick>
              {task.due ? <Clear label="Clear the deadline" onClick={() => patch({ due: "" })} /> : null}
            </Row>
            <Row icon={Repeat} label="Repeat"><RepeatPicker value={task.every} onChange={(every) => patch({ every })} /></Row>
            <Row icon={Bell} label="Reminder"><RemindPicker value={task.remind} dated={!!task.when} today={today} onChange={patch} /></Row>
            <Row icon={Tag} label="Tags"><TaskTags task={task} /></Row>
            <Row icon={MapPin} label="Where" top={!!task.where}>
              {task.where ? <WhereCard where={task.where} onSet={(where) => patch({ where })} className="w-full" />
                : <PlacePick title="Where" onSet={(where) => patch({ where })} trigger={<button type="button" className={cn(chip, "text-faint")}>None</button>} />}
            </Row>
            <Row icon={NotebookText} label="Notes"><LinkedNotes task={task} /></Row>
          </div>
        </div>
      </div>

      <DeleteTask task={confirm ? task : null} onClose={() => setConfirm(false)} onGone={onGone} />
    </article>
  );
  if (!narrow) return card;
  return (
    <Drawer open repositionInputs={false} onOpenChange={(o) => { if (!o) closeTask(); }}>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-[92dvh] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
        <DrawerTitle className="sr-only">{task.title}</DrawerTitle>
        <InSheet value>{card}</InSheet>
      </DrawerContent>
    </Drawer>
  );
}

/** The close and menu buttons a narrow window needs on the card: below `md` the card is a sheet over the list, closed by this
 *  or by pulling it down; from `md` to `lg` the views menu has no rail to live in. */
export function DetailLeading({ onBack, onMenu }: { onBack: () => void; onMenu: () => void }) {
  return (
    <>
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Close" onClick={onBack}><ChevronDown /></Button>
      <Button variant="ghost" size="icon-sm" className="max-md:hidden lg:hidden" aria-label="Views" onClick={onMenu}><Menu /></Button>
    </>
  );
}
