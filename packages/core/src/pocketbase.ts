// The notes server: PocketBase on the owner's host, reached over a private network. One client for the phone, the CLI
// (cli/). Records are keyed by `path` (notes/<id>.md, agent/memory.md); `text` is the
// whole markdown file and the rest of a note's columns are copied out of it here, so every writer sends the same
// ones. Writes are compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): a stale one is a Conflict. No sign-in:
// the private network is the gate (server/pb_migrations/1792400000_open.js). The server tags notes itself: `autotagged`
// and `tagged` are its columns, never sent; so is `kind` (core/notes.ts NoteKind), set when a note is made and read with
// every listing. Tasks are records of their own under the same compare-and-swap
// (`tasks` below; their shape: core/todo.ts); links between records are records too, outside it (`links`
// below; their shape: core/record-links.ts).
import type { AgentModels } from "./agent";
import { saveBody, suggestBody, type ClipPage, type ClipResult, type Suggestions, type Target } from "./clip";
import { getJson, HttpError } from "./http";
import { lensColumns, lensOf, type Lens, type LensFields } from "./lens";
import { noteKindOf, parseNote, type NoteKind } from "./notes";
import { LINK_COLUMNS, linkOf, linkColumn, linkRecord, sameLink, type Link, type LinkEnd, type LinkSide } from "./record-links";
import { taskOf, type Task } from "./todo";

export type Server = { url: string };                      // https://host[:port], no trailing slash
export type Entry = { rec: string; path: string; rev: number };
export type Remote = Entry & { text: string; kind: NoteKind };
/** A listing's line: an Entry and its kind. */
export type Listed = Entry & { kind: NoteKind };
export type Photo = { rec: string; note: string; name: string; file: string; size?: number };

/** What a page says about itself (the server's link-preview route): all strings, empty where the page is silent.
 *  `image` is the picture's address on its own site; `picture` the copy the server keeps of it (`<record>/<file>` in
 *  `link_previews`), empty when it couldn't be had: what a tile draws, at its two sizes. */
export type LinkPreview = { url: string; title: string; description: string; site: string; image: string; icon: string; picture: string };

/** A tile picture's two sizes, PocketBase thumbs (declared on the fields in pb_migrations/1794200000_thumbs.js) and the
 *  agent's PDF pages alike: `blur` a few hundred bytes, shown blurred at once; `sharp` the one that fades in over it. */
export type ThumbSize = "blur" | "sharp";
export const THUMB_SIZES: Record<ThumbSize, string> = { blur: "32x32f", sharp: "640x640f" };

export class Conflict extends Error {}

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
function meaning(e: HttpError, what: string): Error {
  if (e.status === 409) return new Conflict(what);
  const taken = (f: string) => e.body?.data?.[f]?.code === "validation_not_unique";
  if (e.status === 400 && (taken("path") || taken("note") || taken("name") || taken("id"))) return new Conflict(what);
  return e;
}

/** One request, its failures as meaning() reads them. */
export async function call(s: Server, path: string, init: RequestInit = {}): Promise<any> {
  try {
    return await getJson(api(s, path), init, 2);
  } catch (e) {
    throw e instanceof HttpError ? meaning(e, path) : e;
  }
}

/** A filter literal: PocketBase's are double-quoted, with backslash escapes. */
export const lit = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ---- notes

/** Every record's path, rev and kind, no text: what a pull compares the phone against. `kind` comes with every listing
 *  so a copy made before the column existed learns it without a fetch. */
export async function list(s: Server): Promise<Listed[]> {
  const out: Listed[] = [];
  for (let page = 1; ; page++) {
    const j = await call(s, `collections/notes/records?fields=id,path,rev,kind&perPage=${PAGE}&page=${page}&skipTotal=1&sort=path`);
    out.push(...j.items.map((r: any) => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind) })));
    if (j.items.length < PAGE) return out;
  }
}

const remote = (r: any): Remote => ({ rec: r.id, path: r.path, rev: r.rev, text: r.text, kind: noteKindOf(r.kind) });

/** One record by id; null when it's gone. */
export async function get(s: Server, rec: string): Promise<Remote | null> {
  try { return remote(await call(s, `collections/notes/records/${rec}`)); } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** One record by path; null when there's none. */
export async function read(s: Server, path: string): Promise<Remote | null> {
  const j = await call(s, `collections/notes/records?filter=${encodeURIComponent(`path = ${lit(path)}`)}&perPage=1&skipTotal=1`);
  return j.items.length ? remote(j.items[0]) : null;
}

export type Card = { path: string; kind: NoteKind; title: string; tags: string[]; pinned: boolean; updated: string };

/** Every note's list line, pinned first then newest edit: the CLI's `ls`. */
export async function index(s: Server): Promise<Card[]> {
  const out: Card[] = [];
  for (let page = 1; ; page++) {
    const j = await call(s, `collections/notes/records?fields=path,kind,title,tags,pinned,updated&filter=${encodeURIComponent('path ~ "notes/%"')}&sort=-pinned,-updated&perPage=${PAGE}&page=${page}&skipTotal=1`);
    out.push(...j.items.map((r: any) => ({ path: r.path, kind: noteKindOf(r.kind), title: r.title, tags: r.tags ?? [], pinned: r.pinned, updated: r.updated })));
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

/** A record's columns: `text`, and the rest copied out of its frontmatter. Every
 *  writer sends these (the web app's own transport too),
 *  and only these: a PATCH leaves the server's own columns (`autotagged`, `tagged`) as they are. */
export function noteColumns(path: string, text: string) {
  const n = parseNote(path, text);
  return { path, text, title: n.title, day: /^\d{4}-\d{2}-\d{2}$/.test(n.created) ? n.created : "", pinned: n.pinned,
    color: n.color ?? "", tags: n.tags };
}

/** A new note (kind `note`) at rev 1. Conflict: the path is taken. */
export const create = async (s: Server, path: string, text: string): Promise<Remote> =>
  remote(await call(s, "collections/notes/records", json("POST", noteColumns(path, text))));

/** `rev`: the version this edit was based on. Conflict: it has moved on since. null: the record is gone. */
export async function update(s: Server, e: Entry, text: string): Promise<Remote | null> {
  try { return remote(await call(s, `collections/notes/records/${e.rec}`, json("PATCH", { ...noteColumns(e.path, text), rev: e.rev }))); } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
export async function remove(s: Server, e: Pick<Entry, "rec" | "rev">): Promise<void> {
  try { await call(s, `collections/notes/records/${e.rec}?rev=${e.rev}`, { method: "DELETE" }); } catch (err) {
    if (err instanceof HttpError && err.status === 404) return;
    throw err;
  }
}

// ---- tasks

/** A record as the server holds it: its fields and the version they are at. */
export type Versioned<T> = T & { rev: number };
/** A listing's line: what a pull compares against. */
export type RevEntry = { id: string; rev: number };

const ID_BATCH = 40;

/** The calls for one collection under the rev contract (server/pb_hooks/rev.pb.js), its records read by `of`. */
function revCollection<T extends { id: string }>(name: string, of: (r: any) => T) {
  const rec = (r: any): Versioned<T> => ({ ...of(r), rev: r.rev });
  const records = `collections/${name}/records`;
  const gone = (e: unknown) => e instanceof HttpError && e.status === 404;
  const paged = async (s: Server, q: string): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const j = await call(s, `${records}?${q}&perPage=${PAGE}&page=${page}&skipTotal=1`);
      out.push(...j.items);
      if (j.items.length < PAGE) return out;
    }
  };
  return {
    /** Every record's id and rev, nothing else. */
    revs: async (s: Server): Promise<RevEntry[]> => (await paged(s, "fields=id,rev&sort=id")).map((r) => ({ id: r.id, rev: r.rev })),
    /** Every record, or those a PocketBase `filter` picks (build literals with lit), in `sort` order (`order`, `-done`). */
    list: async (s: Server, o: { filter?: string; sort?: string } = {}): Promise<Versioned<T>[]> =>
      (await paged(s, [o.filter ? `filter=${encodeURIComponent(o.filter)}` : "", `sort=${encodeURIComponent(o.sort ?? "order")}`].filter(Boolean).join("&"))).map(rec),
    /** One record; null when there's none. */
    async get(s: Server, id: string): Promise<Versioned<T> | null> {
      try { return rec(await call(s, `${records}/${id}`)); } catch (e) { if (gone(e)) return null; throw e; }
    },
    /** The records of these ids the server has, a few dozen a request. */
    async getMany(s: Server, ids: string[]): Promise<Versioned<T>[]> {
      const out: Versioned<T>[] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const filter = ids.slice(i, i + ID_BATCH).map((id) => `id = ${lit(id)}`).join(" || ");
        out.push(...(await call(s, `${records}?filter=${encodeURIComponent(filter)}&perPage=${ID_BATCH}&skipTotal=1`)).items.map(rec));
      }
      return out;
    },
    /** A new record under the client's own id, at rev 1. Conflict: a record has that id (this create landed before). */
    create: async (s: Server, r: T): Promise<Versioned<T>> => rec(await call(s, records, json("POST", r))),
    /** Some fields changed, from the version `rev`. Conflict: it has moved on since. null: the record is gone. */
    async update(s: Server, id: string, rev: number, fields: Partial<Omit<T, "id">>): Promise<Versioned<T> | null> {
      try { return rec(await call(s, `${records}/${id}`, json("PATCH", { ...fields, id: undefined, rev }))); } catch (e) { if (gone(e)) return null; throw e; }
    },
    /** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
    async remove(s: Server, id: string, rev: number): Promise<void> {
      try { await call(s, `${records}/${id}?rev=${rev}`, { method: "DELETE" }); } catch (e) { if (!gone(e)) throw e; }
    },
  };
}

export type RevCollection<T extends { id: string }> = ReturnType<typeof revCollection<T>>;

export const tasks = revCollection<Task>("tasks", taskOf);

// ---- links

/** A PocketBase filter for the links with `end` on `side`. */
export const linkFilter = (side: LinkSide, end: LinkEnd) => `${linkColumn(side, end.type)} = ${lit(end.id)}`;

const LINK_FIELDS = ["id", ...LINK_COLUMNS, "role"].join(",");

/** The `links` collection (core/record-links.ts): made and deleted, never edited, no `rev`. Both idempotent, so a phone
 *  replays its queue without asking what landed. */
export const links = {
  /** Every link, or those a PocketBase `filter` picks (linkFilter builds one end's), oldest first. A record that isn't a
   *  link (a column set it doesn't know) is left out. */
  async list(s: Server, filter?: string): Promise<Link[]> {
    const out: Link[] = [], f = filter ? `&filter=${encodeURIComponent(filter)}` : "";
    for (let page = 1; ; page++) {
      const j = await call(s, `collections/links/records?fields=${LINK_FIELDS}&sort=created,id&perPage=${PAGE}&page=${page}&skipTotal=1${f}`);
      for (const r of j.items) { const l = linkOf(r); if (l) out.push(l); }
      if (j.items.length < PAGE) return out;
    }
  },
  /** Every link's id: what a pull compares a phone's set against (an id never changes what it points at). */
  async ids(s: Server): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; ; page++) {
      const j = await call(s, `collections/links/records?fields=id&sort=id&perPage=${PAGE}&page=${page}&skipTotal=1`);
      out.push(...j.items.map((r: any) => String(r.id)));
      if (j.items.length < PAGE) return out;
    }
  },
  /** The links with `end` at either side: a note's, both what it points at and what points at it (its backlinks). */
  of: (s: Server, end: LinkEnd) => links.list(s, `${linkFilter("from", end)} || ${linkFilter("to", end)}`),
  /** The links with `end` as their `from`. */
  from: (s: Server, end: LinkEnd) => links.list(s, linkFilter("from", end)),
  /** The links with `end` as their `to`: what points at it. */
  to: (s: Server, end: LinkEnd) => links.list(s, linkFilter("to", end)),
  /** `l` made (newLink names it). Idempotent: one the server has by that id, or another of the same ends and role, is the
   *  link meant, and comes back as the server holds it (a phone keeps the server's id). HttpError 404 is an end that is
   *  gone; any other 400 a link the server refuses. */
  async add(s: Server, l: Link): Promise<Link> {
    try { return linkOf(await call(s, `collections/links/records?fields=${LINK_FIELDS}`, json("POST", linkRecord(l)))) ?? l; } catch (e) {
      if (!(e instanceof Conflict) && !(e instanceof HttpError && e.status === 400)) throw e;
      const had = (await links.list(s, linkFilter("from", l.from))).find((x) => x.id === l.id || sameLink(x, l));
      if (had) return had;
      throw e;
    }
  },
  /** A link gone. Already gone is done. */
  async remove(s: Server, id: string): Promise<void> {
    try { await call(s, `collections/links/records/${id}`, { method: "DELETE" }); } catch (e) {
      if (e instanceof HttpError && e.status === 404) return;
      throw e;
    }
  },
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

/** Where a photo goes up, as a multipart POST: the file under `file`, these fields beside it. Split from the sending so
 *  the phone can stream it from disk natively (expo-file-system's File.upload) and bun can post a Blob (upload). */
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
 *  nothing to summarise, 502 it couldn't be written; the reason is the body's `error` (`clipError`). */
export const pageSummary = async (s: Server, url: string): Promise<string> =>
  (await getJson(api(s, "tefnotes/summary"), json("POST", { url }), 1, 60_000)).summary as string;

/** Whether a preview has anything to draw: a card or a thumbnail needs a title or a picture. */
export const hasPreview = (p: LinkPreview | null | undefined): p is LinkPreview => !!p && (!!p.title || !!p.image);

/** A preview's picture at one of a tile's sizes from the server's copy; undefined when it kept none (the site's
 *  own address is no tile picture: it can't be blurred in, and it would be fetched from the site by every client). */
export const previewPictureUrl = (s: Server, p: Pick<LinkPreview, "picture"> | null | undefined, size: ThumbSize) =>
  p?.picture ? `${s.url}/api/files/link_previews/${p.picture}?thumb=${THUMB_SIZES[size]}` : undefined;

// ---- the clip routes

// Where a shared page, text or picture is filed (server/pb_hooks/clip.pb.js; shapes: core/clip.ts): suggest asks JEV
// where it fits and writes nothing, save writes where the owner chose. A model call is behind each, so they wait longer
// than a read, and neither is retried: a save that failed after landing would land twice.
const CLIP_MS = 120_000;

/** The server's words for a failed clip call (`{error}`), else HTTP's. */
export const clipError = (e: unknown): string => (e instanceof HttpError && typeof e.body?.error === "string" ? e.body.error : e instanceof Error ? e.message : String(e));

/** Where the notes and tasks a clip fits are suggested: `look` the picture as JEV sees it (base64 JPEG). */
export const clipSuggest = (s: Server, page: ClipPage, note: string, look?: string): Promise<Suggestions> =>
  getJson(api(s, "tefnotes/clip/suggest"), json("POST", suggestBody(page, note, look)), 1, CLIP_MS);

/** Where a save goes up, as a multipart POST: `@jsonPayload` beside the picture's JPEG as `file` (a note's clip of a picture
 *  only). Split from the sending as an upload's is: the phone streams the file from disk natively. */
export const clipTo = (s: Server, page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean) =>
  ({ url: api(s, "tefnotes/clip"), fields: { "@jsonPayload": JSON.stringify(saveBody(page, line, target, note, summary)) } });

/** The reply to a save: where it went, or the failure as an HttpError carrying the server's `{error}`. */
export function clipped(status: number, body: string): ClipResult {
  let j: any;
  try { j = JSON.parse(body); } catch { j = undefined; }
  if (status >= 200 && status < 300 && j) return j;
  throw new HttpError(status, `HTTP ${status}`, undefined, j);
}

/** A save with no picture to send: a page's or a text's clip, or any to an existing task. */
export async function clipSave(s: Server, page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean): Promise<ClipResult> {
  const to = clipTo(s, page, line, target, note, summary), form = new FormData();
  for (const [k, v] of Object.entries(to.fields)) form.append(k, v);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CLIP_MS);
  try {
    const r = await fetch(to.url, { method: "POST", body: form, signal: ctl.signal });
    return clipped(r.status, await r.text());
  } finally { clearTimeout(timer); }
}

// ---- the agent

// The agent runs on the server (the sidecar under /agent, same origin): it holds the model keys, the tools and the
// prompt. A chat is a `chats` record the client makes empty before its first send and names in the request; the
// server writes the messages and the title back.

export const agentUrl = (s: Server, p: string) => `${s.url}/agent/${p}`;
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

export const agentModels = (s: Server): Promise<AgentModels> => getJson(agentUrl(s, "models"), {}, 2);

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
