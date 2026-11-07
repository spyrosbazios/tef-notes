// PocketBase's realtime feed: an edit made on the phone shows up here within a second, not at the next refetch.
// The subscription is a POST naming the stream's client id, as PocketBase expects.
import { api } from "./api";

/** A note's record as PocketBase sends it: every column, `text` included. */
export type NoteChange = { action: "create" | "update" | "delete"; record: { id: string; path: string; rev: number; kind?: unknown; text?: string; updated: string } };
export type PhotoChange = { action: "create" | "update" | "delete"; record: { id: string; note: string; name: string } };

/** A link's record as PocketBase sends it: every column (core/record-links.ts linkOf reads it). */
export type LinkChange = { action: "create" | "update" | "delete"; record: { id: string; [column: string]: unknown } };

/** A task's record as PocketBase sends it: every column. */
export type TodoChange = { action: "create" | "update" | "delete"; record: { id: string; rev: number; [column: string]: unknown } };

type Handlers = {
  onNote: (c: NoteChange) => void; onPhoto: (c: PhotoChange) => void; onTask: (c: TodoChange) => void;
  onLink: (c: LinkChange) => void; onChat: () => void; onReconnect: () => void;
};

const RETRY = 1000, RETRY_MAX = 60_000;

/** Calls `onNote` / `onPhoto` / `onTask` / `onLink` for every change to a note, a photo, a task or a link, `onChat` for one to a chat, `onReconnect` when the stream came back after a gap
 *  (events were missed: the caller refetches); returns the unsubscribe. A dropped stream is reopened on a growing delay,
 *  not the browser's fixed one, and at once when the browser says it is back online. */
export function watch({ onNote, onPhoto, onTask, onLink, onChat, onReconnect }: Handlers): () => void {
  let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, wait = RETRY, first = true;
  const close = () => { clearTimeout(retry); es?.close(); es = null; };
  const connect = () => {
    close();
    const mine = es = new EventSource("/api/realtime");
    mine.onopen = () => { wait = RETRY; };
    mine.onerror = () => {
      if (es !== mine) return;
      close();
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, RETRY_MAX);
    };
    mine.addEventListener("PB_CONNECT", (ev) => {
      const { clientId } = JSON.parse((ev as MessageEvent).data);
      api.post("realtime", { clientId, subscriptions: ["notes", "attachments", "tasks", "links", "chats"] }).catch(() => {});
      if (!first) onReconnect();
      first = false;
    });
    mine.addEventListener("notes", (ev) => onNote(JSON.parse((ev as MessageEvent).data)));
    mine.addEventListener("attachments", (ev) => onPhoto(JSON.parse((ev as MessageEvent).data)));
    mine.addEventListener("tasks", (ev) => onTask(JSON.parse((ev as MessageEvent).data)));
    mine.addEventListener("links", (ev) => onLink(JSON.parse((ev as MessageEvent).data)));
    mine.addEventListener("chats", () => onChat());
  };
  const online = () => { wait = RETRY; connect(); };
  connect();
  addEventListener("online", online);
  return () => { removeEventListener("online", online); close(); };
}
