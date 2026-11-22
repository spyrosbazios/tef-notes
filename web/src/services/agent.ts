// The agent runs on the server (the sidecar at /agent, same origin): which models it offers, and the chats it keeps.
// A chat is a PocketBase record (core/record-protocol.ts `chats`): the client makes it empty before the first send and names it
// in the request; the server holds its history from then on (a request carries only the newest message) and writes the messages
// and the title back as it goes, so a chat opens the same on every device. An attached file comes back as a stored chat file's
// address.
import type { UIMessage } from "ai";
import type { AgentModels } from "@/core/agent";
import type { SteerBody, SteerResult } from "@/core/assistant";
import { chats as chatRecords, type ChatLine } from "@/core/record-protocol";
import { api } from "./api";
import { directTransport } from "./records";

export const models = async (): Promise<AgentModels> => (await api.get("/agent/models", { baseURL: "" })).data;

/** The saved chats, newest activity first. */
export const chats = (): Promise<ChatLine[]> => chatRecords.list(directTransport);

/** One chat with its messages; null when it's gone. */
export async function chat(id: string): Promise<(ChatLine & { messages: UIMessage[] }) | null> {
  const c = await chatRecords.get(directTransport, id);
  return c && { id: c.id, title: c.title, updated: c.updated, messages: c.messages as UIMessage[] };
}

/** An empty chat under `id`, so the first send has a record to name. */
export const createChat = (id: string, title: string): Promise<ChatLine> => chatRecords.create(directTransport, id, title);

export const removeChat = (id: string): Promise<void> => chatRecords.remove(directTransport, id);

/** Sends `text` into chat `id`'s running reply (steering); false when the reply ended first, and it goes as a message instead. */
export const steer = async (id: string, text: string): Promise<boolean> =>
  ((await api.post(`/agent/chat/${id}/steer`, { text } satisfies SteerBody, { baseURL: "" })).data as SteerResult).delivered;
