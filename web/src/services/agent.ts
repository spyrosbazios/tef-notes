// The agent runs on the server (the sidecar at /agent, same origin): which models it offers, and the chats it keeps.
// A chat is a PocketBase record: the client makes it empty before the first send and names it in the request, the
// server writes the messages and the title back as it goes (so a chat opens the same on every device).
import type { UIMessage } from "ai";
import type { AgentModels } from "@/core/agent";
import { api, orNull } from "./api";

export const models = async (): Promise<AgentModels> => (await api.get("/agent/models", { baseURL: "" })).data;

export type ChatRec = { id: string; title: string; updated: string };
export type Chat = ChatRec & { messages: UIMessage[] };

const LIST = "id,title,updated";

/** The saved chats, newest activity first. */
export async function chats(): Promise<ChatRec[]> {
  const { data } = await api.get("collections/chats/records", { params: { fields: LIST, sort: "-updated", perPage: 200, skipTotal: 1 } });
  return data.items;
}

/** One chat with its messages; null when it's gone. */
export const chat = (id: string) =>
  orNull(api.get(`collections/chats/records/${id}`, { params: { fields: `${LIST},messages` } }).then((r): Chat => ({ ...r.data, messages: r.data.messages ?? [] })));

/** A new chat's id: PocketBase's own shape (15 of a-z0-9), picked here so the conversation has its id before it has a record. */
export const newChatId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** An empty chat under `id`, so the first send has a record to name. */
export const createChat = async (id: string, title: string): Promise<ChatRec> =>
  (await api.post("collections/chats/records", { id, title, messages: [] }, { params: { fields: LIST } })).data;

export const removeChat = async (id: string): Promise<void> => { await orNull(api.delete(`collections/chats/records/${id}`)); };
