// A chat of its own beside the dock's, open for as long as a panel shows it: an ask about selected words (hooks/ask-session.ts)
// and a note action's run (hooks/note-run.ts) are both one. Apart from React so its life is tested on its own
// (web/test/transient-chat.test.ts); hooks/transient-chat.ts runs it in a component. Its life:
//  - `open`: a session on screen, with what it is about (`meta`: the held words, the action) and no chat yet;
//  - `begin`: the first message makes the chat's record, then goes; the chat's requests are bound to the session (`alive`)
//    while it is the one open. Closed while the record was being made, nothing goes: the record is let go and the prompt is
//    never sent as a plain chat with every tool. Later messages go on in the same chat;
//  - `close`: the reply still running stops; a card waiting for the owner goes to the dock rather than away;
//  - `carry`: the chat goes to the dock ("Open in chat"), a plain chat from then on;
//  - `leave`: the panel's page went (the note closed): a reply still running, or a card, carries on in the dock.
import type { UIMessage } from "ai";
import { asking } from "@/lib/ask";

/** What the session needs of a chat (the AI SDK's `Chat`). */
export type ChatLike = { status: string; lastMessage: UIMessage | undefined; sendMessage(m: { text: string }): unknown };

export type Session<M, C extends ChatLike> = { meta: M; chat: C | null };

/** How a first message went: sent; failed (the chat's record could not be made, the session stays); dropped (the session was
 *  closed, or another opened, meanwhile: nothing was sent). */
export type Began = "sent" | "failed" | "dropped";

export type TransientDeps<M, B, C extends ChatLike> = {
  /** Make the chat's record under `title`, its requests bound by `binding`; null when it could not be made, or when `wanted()`
   *  turned false meanwhile (the record is let go then). Sends nothing. */
  create: (title: string, binding: B, wanted: () => boolean) => Promise<C | null>;
  /** Stop a chat's reply. */
  halt: (chat: C) => void;
  /** Hand a chat to the dock. */
  adopt: (chat: C) => void;
  /** A session ended: let go of what it held (the words). */
  release: (meta: M) => void;
  /** The session on screen changed. */
  changed: (session: Session<M, C> | null) => void;
};

export const busyOf = (chat: ChatLike | null) => chat?.status === "submitted" || chat?.status === "streaming";

/** The machine over `initial`'s hands; `use` swaps them (a component's newest, each render). */
export function transientChat<M, B, C extends ChatLike>(initial: TransientDeps<M, B, C>) {
  let deps = initial, session: Session<M, C> | null = null;
  const put = (s: Session<M, C> | null) => { session = s; deps.changed(s); };

  /** Ends the session on screen; `toDock`: and hands its chat to the dock. */
  const end = (toDock: boolean) => {
    const s = session;
    if (!s) return;
    put(null);
    deps.release(s.meta);
    if (toDock && s.chat) deps.adopt(s.chat);
  };

  /** Closes the session: stops a reply still running; a card waiting goes to the dock. True when it went there. */
  const close = (): boolean => {
    const s = session;
    if (!s) return false;
    const waits = asking(s.chat?.lastMessage);
    if (s.chat && busyOf(s.chat)) deps.halt(s.chat);
    end(waits);
    return waits;
  };

  return {
    use(next: TransientDeps<M, B, C>) { deps = next; },
    now: () => session,
    /** Opens a session about `meta`, closing one already open. */
    open(meta: M) { close(); put({ meta, chat: null }); },
    /** Sends `text`: the first message makes the chat (`title`, bound by `bind` while this session is the one open). */
    async begin(title: string, text: string, bind: (alive: () => boolean, meta: M) => B): Promise<Began> {
      const s = session;
      if (!s) return "dropped";
      if (s.chat) { void s.chat.sendMessage({ text }); return "sent"; }
      const alive = () => session?.meta === s.meta;
      const chat = await deps.create(title, bind(alive, s.meta), alive);
      if (!alive()) return "dropped";
      if (!chat) return "failed";
      put({ meta: s.meta, chat });
      void chat.sendMessage({ text });
      return "sent";
    },
    close,
    carry() { if (session?.chat) end(true); },
    leave() { const s = session; if (s) end(busyOf(s.chat) || asking(s.chat?.lastMessage)); },
  };
}
