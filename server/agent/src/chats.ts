// A chat is a record in `chats` (pb_migrations/1792600000_chats.js): the client creates it, empty, before its first
// message; the agent writes its messages, title and model as a reply streams and when it ends, however it ends.
import type { UIMessage } from "ai";
import { HttpError } from "@/core/http";
import * as pb from "@/core/pocketbase";
import { chatTitle } from "@/core/share";

/** What the history calls a chat: its first user message, as the phone named it. */
export function titleOf(ms: UIMessage[]) {
  const first = ms.find((m) => m.role === "user");
  const text = first?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") ?? "";
  return text.trim() ? chatTitle(text.trim()).slice(0, 200) : "";
}

/** Whether the chat's record is there. */
export async function exists(s: pb.Server, id: string) {
  try { await pb.call(s, `collections/chats/records/${encodeURIComponent(id)}?fields=id`); return true; } catch (e) {
    if (e instanceof HttpError && e.status === 404) return false;
    throw e;
  }
}

/** Saves of one chat, one at a time and in order: a slow mid-stream save never lands after the final one. */
export function saver(s: pb.Server, id: string, model: string) {
  let last = Promise.resolve();
  return (messages: UIMessage[]) => (last = last.then(() =>
    pb.call(s, `collections/chats/records/${encodeURIComponent(id)}`, pb.json("PATCH", { messages, title: titleOf(messages), model }))
      .then(() => undefined, (e: Error) => console.error(`chat ${id}: not saved: ${e.message}`))));
}
