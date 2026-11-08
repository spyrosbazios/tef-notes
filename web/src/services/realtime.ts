// PocketBase's realtime feed: an edit made on the phone shows up here within a second, not at the next refetch.
// The subscription is a POST naming the stream's client id, as PocketBase expects.
import { note } from "@/lib/net";
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
 *  not the browser's fixed one, and at once when the browser says it is back online; closed, not retried, while it says offline. */
export function watch({ onNote, onPhoto, onTask, onLink, onChat, onReconnect }: Handlers): () => void {
  let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, wait = RETRY, first = true;
  const close = () => { clearTimeout(retry); es?.close(); es = null; };
  const connect = () => {
    close();
    const mine = es = new EventSource("/api/realtime");
    mine.onopen = () => { wait = RETRY; note("reached"); };
    mine.onerror = () => {
      if (es !== mine) return;
      note("unreachable");
      first = false;                                  // whatever comes next follows a gap, even when this was the first try
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
  // Offline the stream can only fail: stop reopening it until the browser says it is back (then `connect` reopens it,
  // and the PB_CONNECT of that second connection is `onReconnect`: what was missed is refetched).
  const offline = () => close();
  connect();
  addEventListener("online", online);
  addEventListener("offline", offline);
  return () => { removeEventListener("online", online); removeEventListener("offline", offline); close(); };
}
