// The assistant as state, held above the routes (components/assistant/provider.tsx): the one `Chat` the owner is talking to,
// which survives navigating and closing the dock, the message field, and what the rest of the app asks of it.
import type { Chat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import type { NoteRef } from "@/core/handoff";
import type { Run } from "@/core/note-actions";
import type { Held } from "@/editor";
import type { ChatQueue, Queues } from "@/lib/chat-queue";
import { createContext, useContext } from "react";

/** What a transient chat's requests carry while its panel holds it: an ask's words (`held`, its context, which the selection
 *  tools change), or a note action's run (`scope`, which the server narrows the turn to). Each returns null once let go: a plain
 *  chat from then on. */
export type Binding = { held?: () => Held | null; scope?: () => Run | null };

export type Assistant = {
  /** The conversation; null until the saved one named in the browser's settings has loaded. */
  chat: Chat<UIMessage> | null;
  /** The message field's text: here, not in the panel, so closing the dock keeps what was typed. */
  input: string;
  setInput: (text: string) => void;
  /** The notes the next message is about, shown as chips above the field and named at its start when sent (core/handoff.ts). */
  about: NoteRef[];
  setAbout: (notes: NoteRef[]) => void;
  /** Counts up when something asks for the field to be focused. */
  focusKey: number;
  /** Open the dock and focus the field; with `text`, fill it for the owner to finish and send; with `about`, the notes the
   *  next message is about. */
  show: (draft?: { text?: string; about?: NoteRef[] }) => void;
  /** Send `text`, with any attached `files`, as the next message; false when it could not go (the chat's record could not be made). */
  send: (text: string, files?: FileUIPart[]) => Promise<boolean>;
  /** Stop the reply, and close the tool calls it left unfinished. */
  stop: () => Promise<void>;
  /** A chat with nothing in it yet. */
  newChat: () => void;
  openChat: (id: string) => void;
  /** A chat of its own beside the dock's (an ask, a note action's run: hooks/transient-chat.ts), its record made and titled from
   *  `title` (core/share.ts `chatTitle`), nothing sent. Its requests are bound by `binding` while it returns something. Null when the record could not be made, or
   *  when `wanted()` turned false meanwhile (the panel closed: the record is removed again). */
  transient: (title: string, binding: Binding, wanted: () => boolean) => Promise<Chat<UIMessage> | null>;
  /** Messages typed while a reply ran, each chat's own (lib/chat-queue.ts): the dock moving to another chat keeps them. */
  queues: Queues;
  /** Changes `chat`'s queue. */
  requeue: (chat: string, change: (q: ChatQueue) => ChatQueue) => void;
  /** Queues `text`, with its `files`, on `chat`. */
  enqueue: (chat: string, text: string, files: FileUIPart[]) => void;
  /** Make `chat` the dock's and open the dock on it: an ask carried on in the full chat. */
  adopt: (chat: Chat<UIMessage>) => void;
  /** Stop any chat's reply, and close the tool calls it left unfinished (`stop` is the dock's). */
  halt: (chat: Chat<UIMessage>) => Promise<void>;
};

export const AssistantContext = createContext<Assistant | null>(null);

export function useAssistant(): Assistant {
  const a = useContext(AssistantContext);
  if (!a) throw new Error("useAssistant outside the AssistantProvider");
  return a;
}
