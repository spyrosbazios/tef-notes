// The assistant as state, held above the routes (components/assistant/provider.tsx): the one `Chat` the owner is talking to,
// which survives navigating and closing the dock, the message field, and what the rest of the app asks of it.
import type { Chat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import type { Held } from "@/editor";
import { createContext, useContext } from "react";

export type Assistant = {
  /** The conversation; null until the saved one named in the browser's settings has loaded. */
  chat: Chat<UIMessage> | null;
  /** The message field's text: here, not in the panel, so closing the dock keeps what was typed. */
  input: string;
  setInput: (text: string) => void;
  /** Counts up when something asks for the field to be focused. */
  focusKey: number;
  /** Open the dock and focus the field; with `draft`, fill it for the owner to finish and send. */
  show: (draft?: string) => void;
  /** Send `text`, with any attached `files`, as the next message; false when it could not go (the chat's record could not be made). */
  send: (text: string, files?: FileUIPart[]) => Promise<boolean>;
  /** Stop the reply, and close the tool calls it left unfinished. */
  stop: () => Promise<void>;
  /** A chat with nothing in it yet. */
  newChat: () => void;
  openChat: (id: string) => void;
  /** Ask about words held in a note (the selection bar): `text` goes as the first message of a chat of its own, beside the
   *  dock's, whose context is `held()`'s words while it returns them. Null when the chat's record could not be made. */
  ask: (text: string, held: () => Held | null) => Promise<Chat<UIMessage> | null>;
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
