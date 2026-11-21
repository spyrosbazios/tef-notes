// An ask about selected words in a note (components/selection-ask.tsx): a transient chat (hooks/transient-chat.ts) about the words
// held, from holding them to letting them go.
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { LIMITS } from "@/core/assistant";
import type { Editor, Held } from "@/editor";
import { useTransientChat, type TransientSession } from "@/hooks/transient-chat";
import { asking } from "@/lib/ask";
import { busyOf } from "@/lib/transient-chat";

/** An open ask: the words it holds, and its chat once the first message went. */
export type AskSession = TransientSession<Held>;

/** An ask's life. `start` holds the selected words; `send` asks (the first message makes the chat, which reads its words for as
 *  long as this ask is the one open); `close` lets them go and stops a reply still running, but a card waiting for the owner goes
 *  to the dock rather than away; `carry` hands the chat to the dock. The note closing (or the agent opening another) ends the ask
 *  the same way: a reply still running, or a card, carries on in the dock. */
export function useAskSession(editor: Editor) {
  const { session, open, begin, close: end, carry, leave } = useTransientChat<Held>((held) => held.release());

  const start = useCallback(() => {
    const held = editor.hold();
    if (!held) return false;
    if (held.markdown().length > LIMITS.selection) {
      held.release();
      toast.error(`Select less to ask about it: up to ${LIMITS.selection.toLocaleString()} characters.`);
      return false;
    }
    open(held);
    return true;
  }, [editor, open]);

  /** Sends `text`; false when it could not go (the field gets it back). */
  const send = useCallback(async (text: string) =>
    (await begin(text, text, (alive, held) => ({ held: () => (alive() ? held : null) }))) === "sent", [begin]);

  const close = useCallback((refocus: boolean) => {
    const toDock = end();
    if (refocus && !toDock) editor.focus();
  }, [end, editor]);

  // Another editor: the ask on the last one ends as if its note closed
  useEffect(() => () => leave(), [editor, leave]);

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
