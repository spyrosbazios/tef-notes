// A chat of its own beside the dock's, run in a component (lib/transient-chat.ts is its life): the session on screen as state,
// the provider's `transient` making the chat, and the page going (`leave`) when the component does.
import type { Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import { useAssistant, type Assistant, type Binding } from "@/hooks/assistant";
import { transientChat, type Session, type TransientDeps } from "@/lib/transient-chat";

export type TransientSession<M> = Session<M, Chat<UIMessage>>;

type Deps<M> = TransientDeps<M, Binding, Chat<UIMessage>>;

/** The machine's hands: the assistant's chats, and what the component lets go of. */
function handsOf<M>(assistant: Assistant, release: (meta: M) => void, changed: (s: TransientSession<M> | null) => void): Deps<M> {
  return {
    create: (title, binding, wanted) => assistant.transient(title, binding, wanted),
    halt: (chat) => { void assistant.halt(chat); },
    adopt: (chat) => assistant.adopt(chat),
    release, changed,
  };
}

/** A transient chat's session and its moves; `release` lets go of what an ended session held. */
export function useTransientChat<M>(release: (meta: M) => void = () => {}) {
  const assistant = useAssistant();
  const [session, setSession] = useState<TransientSession<M> | null>(null);
  const [t] = useState(() => transientChat(handsOf(assistant, release, setSession)));
  useEffect(() => { t.use(handsOf(assistant, release, setSession)); }, [t, assistant, release]);
  useEffect(() => () => t.leave(), [t]);
  return { session, open: t.open, begin: t.begin, close: t.close, carry: t.carry, leave: t.leave };
}
