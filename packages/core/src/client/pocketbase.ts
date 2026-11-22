// The notes server over fetch: PocketBase on the owner's host, reached over a private network. The client of the CLI (cli/),
// the agent (server/agent/) and the integration contract; the web app speaks the same protocols over its own axios
// (web/src/services/). Records are keyed by `path` (notes/<id>.md, agent/memory.md); `text` is the
// whole markdown file and the rest of a note's columns are copied out of it here, so every writer sends the same
// ones. Writes are compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): a stale one is a Conflict. No sign-in:
// the private network is the gate (server/pb_migrations/1792400000_open.js). The server tags notes itself: `autotagged`
// and `tagged` are its columns, never sent; so is `kind` (core/notes.ts NoteKind), set when a note is made and read with
// every listing. Tasks are records of their own under the same compare-and-swap
// (`tasks` below; their shape: core/todo.ts); links between records are records too, outside it (`links`
// below; their shape: core/record-links.ts).
import { SEARCH_PATH, searchHitsOf, type SearchHit } from "../find";
import type { LensFields } from "../lens";
import type { LinkPreview } from "../links";
import { noteKindOf, type NoteKind } from "../notes";
import type { Link, LinkEnd } from "../record-links";
import { Conflict, Gone, Refused, Unavailable, conflictOf, likeLit, type Entry, type Remote, type Listed, type Mark } from "../record-contracts";
import { attachments as attachmentProtocol, chats as chatProtocol, createdUnder, lenses as lensProtocol, links as linkProtocol, noteCollection, revCollection, tags as tagProtocol, type RecordTransport } from "../record-protocol";
import type { TagFields, TagMark } from "../tags";
import { taskOf, type Task } from "../todo";
import { agentUrl, type Server } from "../urls";
import { getJson, HttpError } from "./http";

const PAGE = 500;

const api = (s: Server, p: string) => `${s.url}/api/${p}`;
export const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/** An HTTP failure as what it means here: a stale rev; a create whose path, photo name or record id the server has
 *  already — someone else made one by that name first, or this one landed before. Anything else stays an HttpError. */
function meaning(e: HttpError, what: string): Error { return conflictOf(e.status, e.body, what) ?? e; }

/** One request, its failures as meaning() reads them. `timeoutMs`: getJson's by default. */
export async function call(s: Server, path: string, init: RequestInit = {}, timeoutMs?: number): Promise<any> {
  try {
    return await getJson(api(s, path), init, 2, timeoutMs);
  } catch (e) {
    throw e instanceof HttpError ? meaning(e, path) : e;
  }
}

/** Whether `e` leaves open that the write it came from landed: nothing answered (the network, a timeout) or the server failed
 *  (5xx, a 408 or 429 too: the reply is no word on what was done). The server's own refusals (Conflict, Gone, Refused, a 4xx)
 *  are answers: the write did not happen. */
export const unanswered = (e: unknown): boolean =>
  (e instanceof Unavailable && !e.unsent) || (!(e instanceof Unavailable || e instanceof Conflict || e instanceof Gone || e instanceof Refused)
    && (!(e instanceof HttpError) || e.status >= 500 || e.status === 408 || e.status === 429));

/** The record protocols (core/record-protocol.ts) over `s`: the agent's and the CLI's fetch. */
export const transport = (s: Server): RecordTransport => ({
  request: (path, { method, body, timeout, signal } = {}) => call(s, path,
    body === undefined ? { method, signal } : body instanceof FormData ? { method: method ?? "POST", body, signal } : { ...json(method ?? "POST", body), signal },
    timeout),
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
  const filter = [`path ~ "notes/%"`, ...words.map((w) => `(title ~ ${likeLit(w)} || text ~ ${likeLit(w)})`)].join(" && ");
  const j = await call(s, `collections/notes/records?filter=${encodeURIComponent(filter)}&sort=-updated&perPage=${limit}&skipTotal=1`);
  return j.items.map(remote);
}

/** A new note under the caller's own record id (`recordId`), sent again when no answer came back (record-protocol.ts
 *  createdUnder): a repeat that
 *  finds the id taken by a note of this path is the first send having landed, and that note is the answer. Conflict when a record
 *  has that path already, or that id with another path. */
export const create = (s: Server, rec: string, path: string, text: string, mark: Mark = {}): Promise<Remote> => createdUnder(
  () => notes(s).create(rec, path, text, mark),
  async () => { const had = await get(s, rec); return had && had.path === path ? had : null; });
export const update = (s: Server, e: Entry, text: string, mark: Mark = {}): Promise<Remote | null> => notes(s).update(e, text, mark);
export const remove = (s: Server, e: Pick<Entry, "rec" | "rev">): Promise<void> => notes(s).remove(e);

const taskProtocol = revCollection<Task>("tasks", taskOf);
export const tasks = {
  revs: (s: Server) => taskProtocol.revs(transport(s)),
  list: (s: Server, o: { filter?: string; sort?: string } = {}) => taskProtocol.list(transport(s), o),
  get: (s: Server, id: string) => taskProtocol.get(transport(s), id),
  getMany: (s: Server, ids: string[]) => taskProtocol.getMany(transport(s), ids),
  /** A new task under its own id, sent again when no answer came back: a repeat that finds the id taken is the first send having
   *  landed, and the record there is the answer. */
  create: (s: Server, r: Task, mark: Mark = {}) => createdUnder(() => taskProtocol.create(transport(s), r, mark), () => taskProtocol.get(transport(s), r.id)),
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

export const lenses = {
  list: (s: Server) => lensProtocol.list(transport(s)),
  create: (s: Server, l: LensFields) => lensProtocol.create(transport(s), l, recordId()),
};
export const tags = {
  list: (s: Server) => tagProtocol.list(transport(s)),
  create: (s: Server, t: TagFields, mark?: TagMark) => tagProtocol.create(transport(s), t, recordId(), mark),
  update: (s: Server, rec: string, t: TagFields, mark?: TagMark) => tagProtocol.update(transport(s), rec, t, mark),
  rename: (s: Server, from: string, to: string) => tagProtocol.rename(transport(s), from, to),
  describeAll: (s: Server) => tagProtocol.describeAll(transport(s)),
};
export const attachments = {
  list: (s: Server, note?: string) => attachmentProtocol.list(transport(s), note),
  upload: (s: Server, note: string, name: string, file: Blob) => attachmentProtocol.upload(transport(s), note, name, file),
  remove: (s: Server, rec: string) => attachmentProtocol.remove(transport(s), rec),
};
export const chats = {
  get: (s: Server, id: string) => chatProtocol.get(transport(s), id),
  save: (s: Server, id: string, rev: number, c: { messages: unknown; title: string; model: string }) => chatProtocol.save(transport(s), id, rev, c),
};

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

// ---- the agent

// The agent runs on the server (the sidecar under /agent, same origin): it holds the model keys, the tools and the
// prompt. A chat is a `chats` record the client makes empty before its first send and names in the request; the
// server writes the messages and the title back.

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
/** How many pages a note's PDF has, counted by the agent; null when the note has no such PDF. */
export const pdfPages = async (s: Server, note: string, name: string): Promise<number | null> => {
  try {
    return (await getJson(agentUrl(s, `pdf-pages?note=${encodeURIComponent(note)}&name=${encodeURIComponent(name)}`), {}, 2)).pages as number;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
};

/** A record id as PocketBase makes them (15 of [a-z0-9]): a client names a new chat or task before it exists
 *  on the server. */
export const recordId = () => Array.from({ length: 15 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
