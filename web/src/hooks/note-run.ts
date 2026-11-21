// A note action's run (core/note-actions.ts), from the button pressed to the chat let go: the panel on the note
// (components/note-run.tsx) shows it. The run is a transient chat (hooks/transient-chat.ts), narrowed by the server to what the
// action may do for as long as this note holds it. Closing the panel stops a reply still running, and closing it while the run
// is still starting sends nothing; a card waiting for the owner goes to the dock rather than away. "Open in chat" hands the chat
// to the dock, a plain chat from then on.
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback } from "react";
import type { NoteRef } from "@/core/handoff";
import { runMessage, runTitle, type PromptAction } from "@/core/note-actions";
import { useTransientChat, type TransientSession } from "@/hooks/transient-chat";

/** What a run is about: its action, and the note's text as it was when the button was pressed (what Undo puts back). */
export type RunAbout = { action: PromptAction; before: string };

/** A run on screen, its chat once the record was made (null while it is). */
export type NoteRun = TransientSession<RunAbout>;

export function useNoteRun(note: NoteRef) {
  const { session: run, open, begin, close: end, carry } = useTransientChat<RunAbout>();

  const close = useCallback(() => { end(); }, [end]);

  /** Run `action` on the note, whose saved text is `before`; a run already open is closed first. */
  const start = useCallback(async (action: PromptAction, before: string) => {
    open({ action, before });
    const r = await begin(runTitle(action, note), runMessage(action, note), (alive) => ({ scope: () => (alive() ? { id: action.id, note: note.path } : null) }));
    if (r === "failed") end();
  }, [open, begin, end, note]);

  return { run, start, close, carry };
}

/** Whether the run's reply is still on its way: the header's button turns and the note's sheen runs while it is. */
export function useRunning(run: NoteRun | null): boolean {
  const live = useChat<UIMessage>(run?.chat ? { chat: run.chat } : {});
  return !!run && (!run.chat || live.status === "submitted" || live.status === "streaming");
}
