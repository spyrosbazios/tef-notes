// Messages typed while a reply runs (components/assistant/queue.tsx), kept per chat by the assistant's provider: the dock moving to
// another chat and back finds them, and their files, as they were. Pure, tested in web/test/chat-queue.test.ts.
import type { FileUIPart } from "ai";

export type Queued = { id: number; text: string; files: FileUIPart[] };

/** One chat's queue: its messages in order, and whether it is paused (a Stop, a failed send: the owner resumes). */
export type ChatQueue = { items: Queued[]; paused: boolean };

/** Every chat's queue, by chat id; a chat with none has no entry. */
export type Queues = Readonly<Record<string, ChatQueue>>;

const EMPTY: ChatQueue = { items: [], paused: false };

export const queueOf = (all: Queues, chat: string): ChatQueue => all[chat] ?? EMPTY;

/** `all` with `chat`'s queue changed by `change`; an emptied queue goes (and with it its pause). */
export function requeued(all: Queues, chat: string, change: (q: ChatQueue) => ChatQueue): Queues {
  const next = change(queueOf(all, chat)), out: Record<string, ChatQueue> = { ...all };
  if (next.items.length) out[chat] = next; else delete out[chat];
  return out;
}

/** A message added at the end. */
export const added = (item: Queued) => (q: ChatQueue): ChatQueue => ({ ...q, items: [...q.items, item] });
/** The message `id` taken off (sent, steered, removed, or taken back to edit). */
export const without = (id: number) => (q: ChatQueue): ChatQueue => ({ ...q, items: q.items.filter((x) => x.id !== id) });
/** Paused, or resumed. */
export const pausedAs = (paused: boolean) => (q: ChatQueue): ChatQueue => ({ ...q, paused });
