// A note action's run (core/note-actions.ts), from the button pressed to the chat let go: the panel on the note
// (components/note-run.tsx) shows it. The run is a chat of its own (the provider's `run`), narrowed by the server to what the
// action may do for as long as this note holds it. Closing the panel stops a reply still running; a card waiting for the
// owner goes to the dock rather than away, as an ask's does (hooks/ask-session.ts). "Open in chat" hands the chat to the
// dock, a plain chat from then on.
import { useChat, type Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteRef } from "@/core/handoff";
import type { PromptAction } from "@/core/note-actions";
import { useAssistant } from "@/hooks/assistant";
import { asking } from "@/lib/ask";

/** A run on screen: its action, the note's text as it was when the button was pressed (what Undo puts back), and its chat
 *  once the record was made (null while it is, or when it could not be). */
export type NoteRun = { action: PromptAction; before: string; chat: Chat<UIMessage> | null };

const busyOf = (chat: Chat<UIMessage> | null) => chat?.status === "submitted" || chat?.status === "streaming";

export function useNoteRun(note: NoteRef) {
  const assistant = useAssistant();
  const [run, setRun] = useState<NoteRun | null>(null);
  // The run this note holds: what its chat's requests are narrowed by, and what a late answer checks it still belongs to
  const held = useRef<PromptAction | null>(null);
  const now = useRef(run), latest = useRef(assistant);
  useEffect(() => { now.current = run; latest.current = assistant; });

  /** Let the run go; `toDock`: and hand its chat to the dock. */
  const end = useCallback((r: NoteRun, toDock: boolean) => {
    held.current = null;
    setRun(null);
    if (toDock && r.chat) latest.current.adopt(r.chat);
  }, []);

  const close = useCallback(() => {
    const r = now.current;
    if (!r) return;
    const waits = asking(r.chat?.lastMessage);
    if (r.chat && busyOf(r.chat)) void latest.current.halt(r.chat);
    end(r, !!waits);
  }, [end]);

  /** Run `action` on the note, whose saved text is `before`; a run already open is closed first. */
  const start = useCallback(async (action: PromptAction, before: string) => {
    close();
    held.current = action;
    setRun({ action, before, chat: null });
    const chat = await assistant.run(action, note, () => (held.current === action ? { id: action.id, note: note.path } : null));
    // Closed, or another started, while the chat's record was being made: this one goes on in the chat list
    if (held.current !== action) return;
    if (!chat) { held.current = null; setRun(null); return; }
    setRun({ action, before, chat });
  }, [assistant, close, note]);

  const carry = useCallback(() => { const r = now.current; if (r?.chat) end(r, true); }, [end]);

  // The note closed: a reply still running, or a card, carries on in the dock
  useEffect(() => () => {
    const r = now.current;
    if (r) end(r, busyOf(r.chat) || !!asking(r.chat?.lastMessage));
  }, [end]);

  return { run, start, close, carry };
}

/** Whether the run's reply is still on its way: the header's button turns and the note's sheen runs while it is. */
export function useRunning(run: NoteRun | null): boolean {
  const live = useChat<UIMessage>(run?.chat ? { chat: run.chat } : {});
  return !!run && (!run.chat || live.status === "submitted" || live.status === "streaming");
}
