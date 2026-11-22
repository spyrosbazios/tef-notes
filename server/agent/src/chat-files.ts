// The files the owner attaches to a chat message (core/assistant.ts "Attachments"): they arrive as data URLs and are stored
// here, each a `chat_files` record under its chat (pb_migrations/1795700001_chat_files.js), before the message joins the
// history; the saved message points at them (`chatFileUrl`), so a chat's record never holds the bytes. A chat saved before
// then keeps its files inline as data URLs, read as they are. The model still gets every file's content: a PDF as its text
// (pdfs.ts `inlinePdfs`), a photo as a picture (`inlinePictures`), from these bytes.
import type { UIMessage } from "ai";
import { chatFileOf, chatFileUrl } from "@/core/assistant";
import { HttpError } from "@/core/client/http";
import { PDF } from "@/core/photos";
import type { Server } from "@/core/urls";

/** A data URL's bytes and type, or null when it isn't one. */
export function dataOf(url: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  return { type: m[1], bytes: m[2] ? Uint8Array.from(Buffer.from(m[3], "base64")) : new TextEncoder().encode(decodeURIComponent(m[3])) };
}

/** A file part's bytes: a stored chat file's, fetched from the server, or an older chat's data URL's. */
export async function fileBytes(s: Server, url: string): Promise<Uint8Array> {
  const inline = dataOf(url);
  if (inline) return inline.bytes;
  const f = chatFileOf(url);
  if (!f) throw new Error("not a file of this chat");
  const res = await fetch(`${s.url}/api/files/chat_files/${f.rec}/${encodeURIComponent(f.file)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const EXT: Record<string, string> = { [PDF]: "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** The message with each file it carries inline stored under chat `chat`, its part pointing at the record. Throws with why one
 *  couldn't be (then the ones stored before it go again: nothing of the message is kept). */
export async function storeFiles<M extends UIMessage>(s: Server, chat: string, m: M): Promise<M> {
  const made: string[] = [];
  try {
    const parts = [];
    for (const p of m.parts) {
      const inline = p.type === "file" ? dataOf(p.url) : null;
      if (p.type !== "file" || !inline) { parts.push(p); continue; }
      const ext = EXT[p.mediaType];
      if (!ext) throw new Error(`${p.filename ?? "A file"} is not a photo or a PDF.`);
      const form = new FormData();
      form.append("chat", chat);
      form.append("name", (p.filename ?? "").slice(0, 255));
      form.append("file", new Blob([inline.bytes as Uint8Array<ArrayBuffer>], { type: p.mediaType }), `attachment.${ext}`);
      const res = await fetch(`${s.url}/api/collections/chat_files/records`, { method: "POST", body: form });
      const body = await res.json().catch(() => null) as { id?: string; file?: string; message?: string } | null;
      if (!res.ok || !body?.id || !body.file) throw new HttpError(res.status, body?.message ?? `HTTP ${res.status}`, undefined, body);
      made.push(body.id);
      parts.push({ ...p, url: chatFileUrl(body.id, body.file) });
    }
    return made.length ? { ...m, parts } : m;
  } catch (e) {
    await Promise.all(made.map((id) => fetch(`${s.url}/api/collections/chat_files/records/${id}`, { method: "DELETE" }).catch(() => undefined)));
    throw new Error(`Couldn't store the attached file: ${(e as Error).message}`);
  }
}

/** The history with each photo the owner attached as its bytes, a data URL: the model's provider can't reach this server.
 *  An execution copy, never saved. A photo that can't be read is left out with a line saying so. */
export async function inlinePictures<M extends UIMessage>(s: Server, ms: M[]): Promise<M[]> {
  const stored = (p: M["parts"][number]) => p.type === "file" && p.mediaType.startsWith("image/") && !!chatFileOf(p.url);
  return Promise.all(ms.map(async (m) => (m.role !== "user" || !m.parts.some(stored) ? m : {
    ...m,
    parts: await Promise.all(m.parts.map(async (p) => {
      if (p.type !== "file" || !stored(p)) return p;
      try {
        return { ...p, url: `data:${p.mediaType};base64,${Buffer.from(await fileBytes(s, p.url)).toString("base64")}` };
      } catch (e) {
        return { type: "text" as const, text: `(The attached photo ${p.filename ?? ""} couldn't be read: ${(e as Error).message})` };
      }
    })),
  } as M)));
}
