// The notes server: PocketBase on the owner's host, reached over a private network. One client for the phone, the CLI
// (cli/). Records are keyed by `path` (notes/<id>.md, agent/memory.md); `text` is the
// whole markdown file and the rest of a note's columns are copied out of it here, so every writer sends the same
// ones. Writes are compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): a stale one is a Conflict. No sign-in:
// the private network is the gate (server/pb_migrations/1792400000_open.js). The server tags notes itself: `autotagged`
// and `tagged` are its columns, never sent; so is `kind` (core/notes.ts NoteKind), set when a note is made and read with
// every listing. Tasks are records of their own under the same compare-and-swap
// (`tasks` below; their shape: core/todo.ts); links between records are records too, outside it (`links`
// below; their shape: core/record-links.ts).
import { SEARCH_PATH, searchHitsOf, type SearchHit } from "./find";
import { getJson, HttpError } from "./http";
import { lensColumns, lensOf, type Lens, type LensFields } from "./lens";
import { noteKindOf, type NoteKind } from "./notes";
import type { Link, LinkEnd } from "./record-links";
import { conflictOf, lit, type Entry, type Remote, type Listed, type Mark } from "./record-contracts";
export { Conflict, Gone, Refused, Unavailable, lit, noteColumns, type Entry, type Remote, type Listed, type Mark, type Versioned, type RevEntry } from "./record-contracts";
import { noteCollection, revCollection, links as linkProtocol, type RecordTransport } from "./record-protocol";
export { linkFilter } from "./record-protocol";
import { taskOf, type Task } from "./todo";

export type Server = { url: string };                      // https://host[:port], no trailing slash
export type Photo = { rec: string; note: string; name: string; file: string; size?: number };

/** What a page says about itself (the server's link-preview route): all strings, empty where the page is silent.
 *  `image` is the picture's address on its own site; `picture` the copy the server keeps of it (`<record>/<file>` in
 *  `link_previews`), empty when it couldn't be had: what a tile draws, at its two sizes. */
export type LinkPreview = { url: string; title: string; description: string; site: string; image: string; icon: string; picture: string };

/** A tile picture's two sizes, PocketBase thumbs (declared on the fields in pb_migrations/1794200000_thumbs.js) and the
 *  agent's PDF pages alike: `blur` a few hundred bytes, shown blurred at once; `sharp` the one that fades in over it. */
export type ThumbSize = "blur" | "sharp";
export const THUMB_SIZES: Record<ThumbSize, string> = { blur: "32x32f", sharp: "640x640f" };

const PAGE = 500;

/** `https://host:port` out of whatever was pasted: a trailing slash, `/_/`, `/api`, a missing scheme. */
export const serverUrl = (s: string) => {
  const t = s.trim().replace(/\/(_|api)?\/?$/, "").replace(/\/+$/, "");
  return !t || /^https?:\/\//.test(t) ? t : `https://${t}`;
};

const api = (s: Server, p: string) => `${s.url}/api/${p}`;
export const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/** An HTTP failure as what it means here: a stale rev; a create whose path, photo name or record id the server has
 *  already — someone else made one by that name first, or this one landed before. Anything else stays an HttpError. */
function meaning(e: HttpError, what: string): Error { return conflictOf(e.status, e.body, what) ?? e; }

/** One request, its failures as meaning() reads them. */
export async function call(s: Server, path: string, init: RequestInit = {}): Promise<any> {
  try {
    return await getJson(api(s, path), init, 2);
  } catch (e) {
    throw e instanceof HttpError ? meaning(e, path) : e;
  }
}

const transport = (s: Server): RecordTransport => ({
  request: (path, request = {}) => call(s, path, request.body === undefined ? { method: request.method } : json(request.method ?? "POST", request.body)),
  answer: (e) => e instanceof HttpError ? { status: e.status, body: e.body } : undefined,
});
const remote = (r: any): Remote => ({ rec: r.id, path: r.path, rev: r.rev, text: r.text, kind: noteKindOf(r.kind) });
const notes = (s: Server) => noteCollection(transport(s), remote);
export const list = (s: Server): Promise<Listed[]> => notes(s).list();
export const get = (s: Server, rec: string): Promise<Remote | null> => notes(s).get(rec);
export const read = (s: Server, path: string): Promise<Remote | null> => notes(s).read(path);

export type Card = { path: string; kind: NoteKind; title: string; tags: string[]; pinned: boolean; archived: boolean; updated: string };

/** Every note's list line, pinned first then newest edit: the CLI's `ls`. */
export async function index(s: Server): Promise<Card[]> {
  const out: Card[] = [];
  for (let page = 1; ; page++) {
    const j = await call(s, `collections/notes/records?fields=path,kind,title,tags,pinned,archived,updated&filter=${encodeURIComponent('path ~ "notes/%"')}&sort=-pinned,-updated&perPage=${PAGE}&page=${page}&skipTotal=1`);
    out.push(...j.items.map((r: any) => ({ path: r.path, kind: noteKindOf(r.kind), title: r.title, tags: r.tags ?? [], pinned: r.pinned, archived: !!r.archived, updated: r.updated })));
    if (j.items.length < PAGE) return out;
  }
}

/** Notes whose title or text holds every word, newest edit first: the CLI's search (the phone has FTS5 of its own). */
export async function search(s: Server, query: string, limit = 20): Promise<Remote[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const filter = [`path ~ "notes/%"`, ...words.map((w) => `(title ~ ${lit(w)} || text ~ ${lit(w)})`)].join(" && ");
  const j = await call(s, `collections/notes/records?filter=${encodeURIComponent(filter)}&sort=-updated&perPage=${limit}&skipTotal=1`);
  return j.items.map(remote);
}

/** A new note under the caller's own record id (`recordId`); Conflict when a record has that id or that path already. */
export const create = (s: Server, rec: string, path: string, text: string, mark: Mark = {}): Promise<Remote> => notes(s).create(rec, path, text, mark);
export const update = (s: Server, e: Entry, text: string, mark: Mark = {}): Promise<Remote | null> => notes(s).update(e, text, mark);
export const remove = (s: Server, e: Pick<Entry, "rec" | "rev">): Promise<void> => notes(s).remove(e);

const taskProtocol = revCollection<Task>("tasks", taskOf);
export const tasks = {
  revs: (s: Server) => taskProtocol.revs(transport(s)),
  list: (s: Server, o: { filter?: string; sort?: string } = {}) => taskProtocol.list(transport(s), o),
  get: (s: Server, id: string) => taskProtocol.get(transport(s), id),
  getMany: (s: Server, ids: string[]) => taskProtocol.getMany(transport(s), ids),
  create: (s: Server, r: Task, mark: Mark = {}) => taskProtocol.create(transport(s), r, mark),
  update: (s: Server, id: string, rev: number, fields: Partial<Omit<Task, "id">>, mark: Mark = {}) => taskProtocol.update(transport(s), id, rev, fields, mark),
  remove: (s: Server, id: string, rev: number) => taskProtocol.remove(transport(s), id, rev),
};
export const links = {
  list: (s: Server, filter?: string) => linkProtocol.list(transport(s), filter),
  ids: (s: Server) => linkProtocol.ids(transport(s)),
  of: (s: Server, end: LinkEnd) => linkProtocol.of(transport(s), end),
  from: (s: Server, end: LinkEnd) => linkProtocol.from(transport(s), end),
  to: (s: Server, end: LinkEnd) => linkProtocol.to(transport(s), end),
  add: (s: Server, l: Link) => linkProtocol.add(transport(s), l),
  remove: (s: Server, id: string) => linkProtocol.remove(transport(s), id),
};

// ---- lenses

/** The `lenses` collection (core/lens.ts): the owner's saved filters, open rules and no `rev` (a lens is edited whole, like a
 *  tag definition: the last save wins). */
export const lenses = {
  /** Every lens, oldest first (the order the switcher shows). */
  async list(s: Server): Promise<Lens[]> {
    const j = await call(s, `collections/lenses/records?perPage=${PAGE}&skipTotal=1&sort=created,id`);
    return j.items.map(lensOf);
  },
  /** A new lens. */
  create: async (s: Server, l: LensFields): Promise<Lens> => lensOf(await call(s, "collections/lenses/records", json("POST", lensColumns(l)))),
  /** `rec` rewritten. HttpError 404 when it has gone. */
  update: async (s: Server, rec: string, l: LensFields): Promise<Lens> =>
    lensOf(await call(s, `collections/lenses/records/${rec}`, json("PATCH", lensColumns(l)))),
  /** A lens gone. Already gone is done. */
  async remove(s: Server, rec: string): Promise<void> {
    try { await call(s, `collections/lenses/records/${rec}`, { method: "DELETE" }); } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
};

// ---- photos

const photo = (r: any): Photo => ({ rec: r.id, note: r.note, name: r.name, file: r.file });

/** Every photo's record: which note, its name in the body, the stored file. */
export async function photos(s: Server, note?: string): Promise<Photo[]> {
  const out: Photo[] = [], filter = note ? `&filter=${encodeURIComponent(`note = ${lit(note)}`)}` : "";
  for (let page = 1; ; page++) {
    const j = await call(s, `collections/attachments/records?fields=id,note,name,file&perPage=${PAGE}&page=${page}&skipTotal=1${filter}`);
    out.push(...j.items.map(photo));
    if (j.items.length < PAGE) return out;
  }
}

/** Where a photo's bytes are. */
export const photoUrl = (s: Server, p: Pick<Photo, "rec" | "file">) => `${s.url}/api/files/attachments/${p.rec}/${encodeURIComponent(p.file)}`;

/** A photo at one of a tile's sizes, drawn and kept by the server. */
export const photoThumbUrl = (s: Server, p: Pick<Photo, "rec" | "file">, size: ThumbSize) => `${photoUrl(s, p)}?thumb=${THUMB_SIZES[size]}`;

/** Where a photo goes up, as a multipart POST: the file under `file`, these fields beside it (`upload` sends it). */
export const uploadTo = (s: Server, note: string, name: string) =>
  ({ url: api(s, "collections/attachments/records"), fields: { note, name } });

/** The reply to an upload: the new photo, or Conflict when the note has one by that name already. */
export function uploaded(status: number, body: string, name: string): Photo {
  let j: any;
  try { j = JSON.parse(body); } catch { j = undefined; }
  if (status >= 200 && status < 300) return photo(j);
  throw meaning(new HttpError(status, `HTTP ${status}`, undefined, j), name);
}

/** A photo up from bytes in memory: the CLI and the import. */
export async function upload(s: Server, note: string, name: string, file: Blob): Promise<Photo> {
  const to = uploadTo(s, note, name), form = new FormData();
  for (const [k, v] of Object.entries(to.fields)) form.append(k, v);
  form.append("file", file, name);
  const r = await fetch(to.url, { method: "POST", body: form });
  return uploaded(r.status, await r.text(), name);
}

/** A photo gone. Already gone is done. */
export async function removePhoto(s: Server, rec: string): Promise<void> {
  try { await call(s, `collections/attachments/records/${rec}`, { method: "DELETE" }); } catch (e) {
    if (e instanceof HttpError && e.status === 404) return;
    throw e;
  }
}

// ---- link previews

/** The server's read of a page (server/pb_hooks/link-preview.pb.js): HttpError 400 is a URL it won't fetch (private
 *  address, not http), anything else a failure to ask. */
export const linkPreview = (s: Server, url: string): Promise<LinkPreview> => call(s, `tefnotes/link-preview?url=${encodeURIComponent(url)}`);

/** A page's HTML fetched through the same guard (server/pb_hooks/reader.pb.js), for the agent's reader: HttpError 400
 *  a URL it won't fetch, 422 no web page, 502 the site didn't answer. */
export const pageHtml = (s: Server, url: string): Promise<{ url: string; html: string }> => call(s, `tefnotes/page?url=${encodeURIComponent(url)}`);

/** The summary of the page at `url` (server/pb_hooks/summary.pb.js), as the markdown block a note's editor puts under the
 *  link: the server reads the page and asks its model, so it waits as a clip does. HttpError 400 a URL it won't fetch, 422
 *  nothing to summarise, 502 it couldn't be written; the reason is the body's `error`. */
export const pageSummary = async (s: Server, url: string): Promise<string> =>
  (await getJson(api(s, "tefnotes/summary"), json("POST", { url }), 1, 60_000)).summary as string;

/** Whether a preview has anything to draw: a card or a thumbnail needs a title or a picture. */
export const hasPreview = (p: LinkPreview | null | undefined): p is LinkPreview => !!p && (!!p.title || !!p.image);

/** A preview's picture at one of a tile's sizes from the server's copy; undefined when it kept none (the site's
 *  own address is no tile picture: it can't be blurred in, and it would be fetched from the site by every client). */
export const previewPictureUrl = (s: Server, p: Pick<LinkPreview, "picture"> | null | undefined, size: ThumbSize) =>
  p?.picture ? `${s.url}/api/files/link_previews/${p.picture}?thumb=${THUMB_SIZES[size]}` : undefined;

// ---- the agent

// The agent runs on the server (the sidecar under /agent, same origin): it holds the model keys, the tools and the
// prompt. A chat is a `chats` record the client makes empty before its first send and names in the request; the
// server writes the messages and the title back.

export const agentUrl = (s: Server, p: string) => `${s.url}/agent/${p}`;

/** A drawing's PNG drawn by the server from its scene (server/agent/src/drawing-picture.ts): for a scene made outside the
 *  web's editor, which exports its own. Throws with the server's reason when it isn't a scene. */
export async function drawingPicture(s: Server, scene: string): Promise<Blob> {
  const r = await fetch(agentUrl(s, "drawing-picture"), { method: "POST", headers: { "Content-Type": "application/json" }, body: scene });
  if (!r.ok) throw new Error(`the server couldn't draw it (${r.status}): ${await r.text()}`);
  return r.blob();
}

/** Notes by their words and meaning (`find.ts` `SEARCH_PATH`): the agent's own search, best first. */
export const searchByMeaning = async (s: Server, q: string, limit = 10): Promise<SearchHit[]> =>
  searchHitsOf(await getJson(agentUrl(s, `${SEARCH_PATH}?q=${encodeURIComponent(q)}&limit=${limit}`), {}, 2));
/** A note's PDF's first page as a JPEG at one of a tile's sizes, rendered by the agent: a tile's picture. */
export const pdfThumbUrl = (s: Server, note: string, name: string, size: ThumbSize) =>
  agentUrl(s, `pdf-thumb?note=${encodeURIComponent(note)}&name=${encodeURIComponent(name)}&size=${size}`);

/** How many pages a note's PDF has, counted by the agent; null when the note has no such PDF. */
export const pdfPages = async (s: Server, note: string, name: string): Promise<number | null> => {
  try {
    return (await getJson(agentUrl(s, `pdf-pages?note=${encodeURIComponent(note)}&name=${encodeURIComponent(name)}`), {}, 2)).pages as number;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
};

export type ChatRec = { id: string; title: string; updated: string };
export type Chat = ChatRec & { messages: unknown[] };

const CHAT_FIELDS = "id,title,updated";

/** A record id as PocketBase makes them (15 of [a-z0-9]): a client names a new chat or task before it exists
 *  on the server. */
export const recordId = () => Array.from({ length: 15 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/** The saved chats, newest activity first. */
export async function chats(s: Server): Promise<ChatRec[]> {
  return (await call(s, `collections/chats/records?fields=${CHAT_FIELDS}&sort=-updated&perPage=200&skipTotal=1`)).items;
}

/** One chat with its messages; null when there's none by that id (yet). */
export async function chat(s: Server, id: string): Promise<Chat | null> {
  try {
    const r = await call(s, `collections/chats/records/${id}?fields=${CHAT_FIELDS},messages`);
    return { ...r, messages: Array.isArray(r.messages) ? r.messages : [] };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** The empty record a first send names. Already there (a retry after a create that did land) is done. */
export async function createChat(s: Server, id: string, title: string): Promise<void> {
  try { await call(s, `collections/chats/records?fields=id`, json("POST", { id, title, messages: [] })); } catch (e) {
    if (e instanceof HttpError && e.status === 400 && e.body?.data?.id?.code === "validation_not_unique") return;
    throw e;
  }
}

/** A chat gone. Already gone is done. */
export async function removeChat(s: Server, id: string): Promise<void> {
  try { await call(s, `collections/chats/records/${id}`, { method: "DELETE" }); } catch (e) {
    if (e instanceof HttpError && e.status === 404) return;
    throw e;
  }
}
