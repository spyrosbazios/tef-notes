// An ask about selected words in a note (components/selection-ask.tsx): its life, from the words held to the chat let go.
import type { Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LIMITS } from "@/core/assistant";
import type { Editor, Held } from "@/editor";
import { useAssistant } from "@/hooks/assistant";
import { asking } from "@/lib/ask";

/** An open ask: the words it holds, and its chat once the first message went. */
export type AskSession = { held: Held; chat: Chat<UIMessage> | null };

const busyOf = (chat: Chat<UIMessage> | null) => chat?.status === "submitted" || chat?.status === "streaming";

/** An ask's life. `start` holds the selected words; `send` asks (the first message makes the chat, which reads its words
 *  for as long as this ask is the one open); `close` lets them go and stops a reply still running, but a card waiting for
 *  the owner goes to the dock rather than away; `carry` hands the chat to the dock. The note closing (or the agent opening
 *  another) ends the ask the same way: a reply still running, or a card, carries on in the dock. */
export function useAskSession(editor: Editor) {
  const assistant = useAssistant();
  const [session, setSession] = useState<AskSession | null>(null);
  // The ask that is open: what a chat's context and selection tools check their own words against
  const live = useRef<Held | null>(null);
  const now = useRef(session), latest = useRef(assistant);
  useEffect(() => { now.current = session; latest.current = assistant; });

  const start = useCallback(() => {
    const held = editor.hold();
    if (!held) return false;
    if (held.markdown().length > LIMITS.selection) {
      held.release();
      toast.error(`Select less to ask about it: up to ${LIMITS.selection.toLocaleString()} characters.`);
      return false;
    }
    live.current = held;
    setSession({ held, chat: null });
    return true;
  }, [editor]);

  const send = useCallback(async (text: string) => {
    const s = now.current;
    if (!s) return false;
    if (s.chat) { void s.chat.sendMessage({ text }); return true; }
    // Bound to these words: once this ask is closed, or another opened, the chat holds nothing
    const held = s.held;
    const chat = await assistant.ask(text, () => (live.current === held ? held : null));
    if (!chat) return false;
    // Closed while the chat's record was being made: the ask goes on in the chat list, holding nothing
    if (now.current?.held === held) setSession({ held, chat });
    return true;
  }, [assistant]);

  /** Let the words go; `toDock`: and hand the chat to the dock. */
  const end = useCallback((s: AskSession, toDock: boolean) => {
    live.current = null;
    s.held.release();
    setSession(null);
    if (toDock && s.chat) latest.current.adopt(s.chat);
  }, []);

  const carry = useCallback(() => { const s = now.current; if (s?.chat) end(s, true); }, [end]);

  const close = useCallback((refocus: boolean) => {
    const s = now.current;
    if (!s) return;
    const waits = asking(s.chat?.lastMessage);
    if (s.chat && busyOf(s.chat)) void assistant.halt(s.chat);
    end(s, waits);
    if (refocus && !waits) editor.focus();
  }, [assistant, editor, end]);

  useEffect(() => () => {
    const s = now.current;
    if (s) end(s, busyOf(s.chat) || asking(s.chat?.lastMessage));
  }, [editor, end]);

  return { session, start, send, close, carry };
}

/** A press outside `el` closes the ask, unless a reply is running or a card waits (a stray tap must not drop it). Presses in
 *  a popup the panel opened (a menu, a card's popover) are its own. */
export function useCloseOutside(el: React.RefObject<HTMLElement | null>, session: AskSession | null, close: (refocus: boolean) => void) {
  useEffect(() => {
    if (!session) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || el.current?.contains(t) || t.closest("[data-radix-popper-content-wrapper], [role=dialog], [data-sonner-toaster]")) return;
      if (busyOf(session.chat) || asking(session.chat?.lastMessage)) return;
      close(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [el, session, close]);
}
