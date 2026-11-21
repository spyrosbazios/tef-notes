// What the note pane does around an assistant action's run (core/note-actions.ts): the note saved first so the agent reads
// what is on screen, the run started, and, when it wrote, the toast that says so with an Undo for a change to the note.
import { useMemo } from "react";
import { toast } from "sonner";
import type { PromptAction } from "@/core/note-actions";
import { undoEdit } from "@/core/notes";
import { write } from "@/hooks/notes";
import { useNoteRun, useRunning } from "@/hooks/note-run";
import { syncNow } from "@/hooks/sync";
import { message } from "@/services/api";
import type { NoteRec } from "@/services/notes";

/** `flush`: sends what the note has pending; `fresh`: the note as the cache holds it now. */
export function useNoteRunActions(n: NoteRec, flush: () => Promise<unknown>, fresh: () => NoteRec) {
  /** An assistant action pressed (core/note-actions.ts): the note saved first, so the agent reads what is on screen. */
  const about = useMemo(() => ({ path: n.path, title: n.note.title }), [n.path, n.note.title]);
  const runs = useNoteRun(about), running = useRunning(runs.run);
  const runAction = async (a: PromptAction) => {
    try { await flush(); } catch (e) { toast.error(message(e)); return; }
    await runs.start(a, fresh().text);
  };
  /** The run wrote: the panel closes and a toast says what it did; a note's change can be put back as it was. */
  const ran = (said: string) => {
    const r = runs.run?.meta;
    if (!r) return;
    runs.close();
    // What the run wrote, once it has reached this browser's copy: Undo takes back that edit and keeps what was written after
    const wrote = syncNow().then(() => fresh().text);
    wrote.catch(() => undefined);
    const undo = r.action.result === "edit" ? {
      label: "Undo",
      onClick: () => {
        void wrote.then((after) => syncNow().then(() => write(n, (current) => {
          const text = undoEdit(r.before, after, current);
          if (text == null) throw new Error("Not undone: the note was edited in the same place since.");
          return text;
        }))).catch((e: unknown) => toast.error(message(e)));
      },
    } : undefined;
    toast(r.action.label, { description: said || (r.action.result === "edit" ? "The note was changed." : "The task was added."), action: undo });
  };
  return { runs, running, runAction, ran };
}
