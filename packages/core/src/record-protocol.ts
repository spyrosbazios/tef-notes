// Collection protocol shared by fetch and axios: one per collection (notes, tasks, links, lenses, tags, attachments, chats; the
// preferences' is prefs-sync.ts) and the tag routes beside them. The injected transport owns I/O, retries and connectivity; this
// module owns records, pagination, write semantics and what PocketBase's answers mean: every call here fails with one of the
// typed outcomes of record-contracts (Conflict, Gone, Refused, Unavailable), never a transport's own error, so a caller (the
// sync engine, a toast) switches on types, never on status codes.
import { CHAT_FIELDS, chatOf, serializeChatHistory, type StoredChat } from "./chat-history";
import { lensColumns, lensOf, type Lens, type LensFields } from "./lens";
import { noteKindOf } from "./notes";
import type { Photo } from "./photos";
import { Conflict, Gone, Refused, Unavailable, conflictOf, lit, noteColumns, serverError, type Entry, type Listed, type Mark, type RevEntry, type Versioned } from "./record-contracts";
import { LINK_COLUMNS, linkOf, linkColumn, linkRecord, sameLink, type Link, type LinkEnd, type LinkSide } from "./record-links";
import type { Heard } from "./sync";
import { tagColumns, tagDef, type Described, type Renamed, type TagDef, type TagFields, type TagMark } from "./tags";
import { taskOf } from "./todo";

/** `body` a FormData goes as a multipart form (an upload), anything else as JSON. `signal`: the caller's Stop. */
export type RecordRequest = { method?: string; body?: unknown; timeout?: number; signal?: AbortSignal };
export type RecordTransport = {
  request(path: string, request?: RecordRequest): Promise<any>;
  /** What the server answered to a failed request; undefined when nothing answered (a timeout, a refused or dropped connection). */
  answer(error: unknown): { status: number; body: unknown } | undefined;
};

/** What PocketBase's answer `status`/`body` to a request for `what` means. A missing record is 404; a write naming a relation
 *  to one that is gone is 400 with `validation_missing_rel_records` on that field (server/integration/contract.ts pins both). */
export function outcomeOf(status: number, body: unknown, what: string): Conflict | Gone | Refused | Unavailable {
  const conflict = conflictOf(status, body, what);
  if (conflict) return conflict;
  const b = body as { message?: unknown; data?: Record<string, { code?: unknown; message?: unknown }> } | null | undefined;
  const fields = Object.entries(b?.data ?? {});
  if (status === 404 || (status === 400 && fields.some(([, f]) => f?.code === "validation_missing_rel_records"))) return new Gone(what);
  if (status === 408 || status === 429 || status >= 500) return new Unavailable(serverError(body) ?? `${what}: HTTP ${status}`);
  const said = serverError(body) ?? `HTTP ${status}`;
  const why = fields.map(([k, f]) => `${k}: ${typeof f?.message === "string" ? f.message : String(f?.code ?? "")}`).join("; ");
  return new Refused(why ? `${said} (${why})` : said);
}

/** A realtime event (PocketBase sends `action` and the whole record) for the sync engine (sync.ts `takeHeard`); null for a record
 *  not of the shape it should have (the caller then pulls everything instead). A note's `at` is its `updated`. */
export function heardOf(topic: Heard["topic"], action: unknown, r: any): Heard | null {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id) return null;
  const gone = action === "delete";
  if (topic === "notes") {
    if (typeof r.path !== "string") return null;
    if (gone) return { topic, gone: { rec: r.id, path: r.path } };
    if (typeof r.rev !== "number" || typeof r.text !== "string") return null;
    return { topic, note: { rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind), text: r.text, at: Date.parse(r.updated) || undefined } };
  }
  if (topic === "tasks") {
    if (gone) return { topic, gone: r.id };
    return typeof r.rev === "number" ? { topic, task: { ...taskOf(r), rev: r.rev } } : null;
  }
  if (gone) return { topic, gone: r.id };
  const link = linkOf(r);
  return link ? { topic, link } : null;
}

const typed = (e: unknown) => e instanceof Conflict || e instanceof Gone || e instanceof Refused || e instanceof Unavailable;

/** One request, a failure as its typed outcome (one the transport typed itself, a web page's Offline, as it is). */
async function call(s: RecordTransport, path: string, request?: RecordRequest): Promise<any> {
  try { return await s.request(path, request); } catch (e) {
    if (typed(e)) throw e;
    const a = s.answer(e);
    throw a ? outcomeOf(a.status, a.body, path) : new Unavailable(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const json = (method: string, body: unknown): RecordRequest => ({ method, body });
/** `run`, null when the record is gone. */
async function orGone<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e) { if (e instanceof Gone) return null; throw e; }
}
const PAGE = 500;

/** A create under an id the caller made, sent again when no answer came back (`unanswered`: by default an `Unavailable`). A
 *  transport sends a write once, since a second send after a landed one acts twice; under its own id a create can be repeated:
 *  the server holds that id once. `make` sends it; `there` reads the record by that id (null: none). A Conflict means the id is
 *  taken, which after our own earlier try is that try having landed: the record `there` finds is the answer, and no new id is
 *  ever made. A Conflict with nothing under the id is another record's (a path, a name): it goes back to the caller as it was. */
export async function createdUnder<T>(make: () => Promise<T>, there: () => Promise<T | null>,
  { tries = 3, wait = 500, unanswered = (e: unknown): boolean => e instanceof Unavailable && !e.unsent } = {}): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await make(); } catch (e) {
      if (e instanceof Conflict) {
        const had = await there();
        if (had) return had;
        throw e;
      }
      if (!unanswered(e) || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait * 2 ** i));
    }
  }
}

/** Every record of `records` a `filter` picks, PAGE at a time by id (`id > last`, sorted by id), with `fields` (which must
 *  name `id`). Keyset, not offsets: a record made or deleted between two pages moves no other one out of the listing, which a
 *  pull would read as deleted. */
async function every(s: RecordTransport, records: string, o: { fields?: string; filter?: string } = {}): Promise<any[]> {
  const out: any[] = [];
  for (let last: string | null = null; ;) {
    const filter = [o.filter ? `(${o.filter})` : "", last == null ? "" : `id > ${lit(last)}`].filter(Boolean).join(" && ");
    const j = await call(s, `${records}?${o.fields ? `fields=${o.fields}&` : ""}sort=id&perPage=${PAGE}&skipTotal=1${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`);
    out.push(...j.items);
    if (j.items.length < PAGE) return out;
    last = String(j.items[j.items.length - 1].id);
  }
}

/** `rows` in a PocketBase `sort` order (`order`, `-done,created`), ties by id: a keyset listing comes by id, and is put in the
 *  order asked for here. */
function sorted(rows: any[], sort: string): any[] {
  const keys = sort.split(",").map((k) => k.trim()).filter(Boolean).map((k) => (k.startsWith("-") ? [k.slice(1), -1] as const : [k.replace(/^\+/, ""), 1] as const));
  const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows].sort((x, y) => {
    for (const [k, d] of keys) { const c = cmp(x[k], y[k]); if (c) return c * d; }
    return cmp(x.id, y.id);
  });
}

/** A note reader may retain client-specific fields. Filtering the sync listing is a client policy. */
export function noteCollection<T>(s: RecordTransport, of: (r: any) => T, options: { fields?: string; filter?: string } = {}) {
  const records = "collections/notes/records";
  const fields = options.fields ? `fields=${options.fields}&` : "";
  const at = (id: string) => `${records}/${id}${options.fields ? `?fields=${options.fields}` : ""}`;
  return {
    /** Every note's record, path, rev and kind, by record id. */
    async list(): Promise<Listed[]> {
      return (await every(s, records, { fields: "id,path,rev,kind", filter: options.filter }))
        .map((r: any) => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind) }));
    },
    get: (id: string) => orGone(async () => of(await call(s, at(id)))),
    async read(path: string, timeout?: number): Promise<T | null> {
      const j = await call(s, `${records}?${fields}filter=${encodeURIComponent(`path = ${lit(path)}`)}&perPage=1&skipTotal=1`, { timeout });
      return j.items.length ? of(j.items[0]) : null;
    },
    /** A new note under the client's own record id (`recordId`). Conflict: a record has that id (this create landed before:
     *  read it back by `rec`) or that path (another note's). */
    create: async (rec: string, path: string, text: string, mark: Mark = {}): Promise<T> =>
      of(await call(s, `${records}${options.fields ? `?fields=${options.fields}` : ""}`, json("POST", { id: rec, ...noteColumns(path, text), ...mark }))),
    update: (e: Entry, text: string, mark: Mark = {}) => orGone(async () =>
      of(await call(s, at(e.rec), json("PATCH", { ...noteColumns(e.path, text), rev: e.rev, ...mark })))),
    async remove(e: Pick<Entry, "rec" | "rev">): Promise<void> {
      await orGone(() => call(s, `${records}/${e.rec}?rev=${e.rev}`, { method: "DELETE" }));
    },
  };
}

const ID_BATCH = 40;

/** The calls for one collection under the rev contract (server/pb_hooks/rev.pb.js), its records read by `of`. */
export function revCollection<T extends { id: string }>(name: string, of: (r: any) => T) {
  const rec = (r: any): Versioned<T> => ({ ...of(r), rev: r.rev });
  const records = `collections/${name}/records`;
  return {
    rec,
    /** Every record's id and rev, nothing else. */
    revs: async (s: RecordTransport): Promise<RevEntry[]> => (await every(s, records, { fields: "id,rev" })).map((r) => ({ id: r.id, rev: r.rev })),
    /** Every record, or those a PocketBase `filter` picks (build literals with lit), in `sort` order (`order`, `-done`). */
    list: async (s: RecordTransport, o: { filter?: string; sort?: string } = {}): Promise<Versioned<T>[]> =>
      sorted(await every(s, records, { filter: o.filter }), o.sort ?? "order").map(rec),
    /** One record; null when there's none. */
    async get(s: RecordTransport, id: string): Promise<Versioned<T> | null> {
      return orGone(async () => rec(await call(s, `${records}/${id}`)));
    },
    /** The records of these ids the server has, a few dozen a request. */
    async getMany(s: RecordTransport, ids: string[]): Promise<Versioned<T>[]> {
      const out: Versioned<T>[] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const filter = ids.slice(i, i + ID_BATCH).map((id) => `id = ${lit(id)}`).join(" || ");
        out.push(...(await call(s, `${records}?filter=${encodeURIComponent(filter)}&perPage=${ID_BATCH}&skipTotal=1`)).items.map(rec));
      }
      return out;
    },
    /** A new record under the client's own id, at rev 1. Conflict: a record has that id (this create landed before). */
    create: async (s: RecordTransport, r: T, mark: Mark = {}): Promise<Versioned<T>> => rec(await call(s, records, json("POST", { ...r, ...mark }))),
    /** Some fields changed, from the version `rev`. Conflict: it has moved on since. null: the record is gone. */
    async update(s: RecordTransport, id: string, rev: number, fields: Partial<Omit<T, "id">>, mark: Mark = {}): Promise<Versioned<T> | null> {
      return orGone(async () => rec(await call(s, `${records}/${id}`, json("PATCH", { ...fields, id: undefined, rev, ...mark }))));
    },
    /** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
    async remove(s: RecordTransport, id: string, rev: number): Promise<void> {
      await orGone(() => call(s, `${records}/${id}?rev=${rev}`, { method: "DELETE" }));
    },
  };
}

// ---- links

/** A PocketBase filter for the links with `end` on `side`. */
export const linkFilter = (side: LinkSide, end: LinkEnd) => `${linkColumn(side, end.type)} = ${lit(end.id)}`;

const LINK_FIELDS = ["id", ...LINK_COLUMNS, "role"].join(",");

/** The `links` collection (core/record-links.ts): made and deleted, never edited, no `rev`. Both idempotent, so a phone
 *  replays its queue without asking what landed. */
export const links = {
  /** Every link, or those a PocketBase `filter` picks (linkFilter builds one end's), oldest first. A record that isn't a
   *  link (a column set it doesn't know) is left out. */
  async list(s: RecordTransport, filter?: string): Promise<Link[]> {
    const rows = sorted(await every(s, "collections/links/records", { fields: `${LINK_FIELDS},created`, filter }), "created");
    return rows.flatMap((r) => { const l = linkOf(r); return l ? [l] : []; });
  },
  /** Every link's id: what a pull compares a phone's set against (an id never changes what it points at). */
  async ids(s: RecordTransport): Promise<string[]> {
    return (await every(s, "collections/links/records", { fields: "id" })).map((r) => String(r.id));
  },
  /** The links with `end` at either side: a note's, both what it points at and what points at it (its backlinks). */
  of: (s: RecordTransport, end: LinkEnd) => links.list(s, `${linkFilter("from", end)} || ${linkFilter("to", end)}`),
  /** The links with `end` as their `from`. */
  from: (s: RecordTransport, end: LinkEnd) => links.list(s, linkFilter("from", end)),
  /** The links with `end` as their `to`: what points at it. */
  to: (s: RecordTransport, end: LinkEnd) => links.list(s, linkFilter("to", end)),
  /** `l` made (newLink names it). Idempotent: one the server has by that id, or another of the same ends and role, is the
   *  link meant, and comes back as the server holds it (a phone keeps the server's id). Gone: an end is not on the server;
   *  Refused: a link the server won't take. */
  async add(s: RecordTransport, l: Link): Promise<Link> {
    try { return linkOf(await call(s, `collections/links/records?fields=${LINK_FIELDS}`, json("POST", linkRecord(l)))) ?? l; } catch (e) {
      if (!(e instanceof Conflict || e instanceof Refused)) throw e;
      const had = (await links.list(s, linkFilter("from", l.from))).find((x) => x.id === l.id || sameLink(x, l));
      if (had) return had;
      throw e;
    }
  },
  /** The links of these ids, with the same pagination and defensive reader as a listing. */
  async byIds(s: RecordTransport, ids: string[]): Promise<Link[]> {
    const out: Link[] = [];
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      out.push(...await links.list(s, ids.slice(i, i + ID_BATCH).map((id) => `id = ${lit(id)}`).join(" || ")));
    }
    return out;
  },
  /** A link gone. Already gone is done. */
  async remove(s: RecordTransport, id: string): Promise<void> {
    await orGone(() => call(s, `collections/links/records/${id}`, { method: "DELETE" }));
  },
};

// ---- lenses

const LENSES = "collections/lenses/records";

/** The `lenses` collection (core/lens.ts): the owner's saved filters, open rules and no `rev` (a lens is edited whole, like a
 *  tag definition: the last save wins). */
export const lenses = {
  /** Every lens, oldest first (the order the switcher shows). */
  list: async (s: RecordTransport): Promise<Lens[]> => sorted(await every(s, LENSES), "created").map(lensOf),
  /** A new lens under the caller's id: sent again when no answer came, never twice. Conflict: a lens by that name (ignoring
   *  case) exists. */
  create: (s: RecordTransport, l: LensFields, id: string): Promise<Lens> => createdUnder(
    async () => lensOf(await call(s, LENSES, json("POST", { id, ...lensColumns(l) }))),
    () => orGone(async () => lensOf(await call(s, `${LENSES}/${id}`)))),
  /** `rec` rewritten. Gone when it has gone. */
  update: async (s: RecordTransport, rec: string, l: LensFields): Promise<Lens> => lensOf(await call(s, `${LENSES}/${rec}`, json("PATCH", lensColumns(l)))),
  /** A lens gone. Already gone is done. */
  async remove(s: RecordTransport, rec: string): Promise<void> {
    await orGone(() => call(s, `${LENSES}/${rec}`, { method: "DELETE" }));
  },
};

// ---- tags

const TAGS = "collections/tags/records";
// A model call is behind a rename's sweep, a description and a guess, so they wait longer than a read (being writes, they
// are sent once).
const RENAME_MS = 90_000, DESCRIBE_MS = 90_000, DESCRIBE_ALL_MS = 600_000, GUESS_MS = 20_000;

/** The `tags` collection (core/tags.ts): definitions, open rules and no `rev` (the last save wins), and the server's tag routes
 *  (server/pb_hooks/tags.pb.js, autotag.pb.js). */
export const tags = {
  /** Every definition, by name. */
  list: async (s: RecordTransport): Promise<TagDef[]> => sorted(await every(s, TAGS), "name").map(tagDef),
  /** A new definition under the caller's id: sent again when no answer came, never twice. Conflict: a tag by that name (ignoring
   *  case) exists. `mark`: who wrote the description when it isn't the owner. */
  create: (s: RecordTransport, t: TagFields, id: string, mark?: TagMark): Promise<TagDef> => createdUnder(
    async () => tagDef(await call(s, TAGS, json("POST", { id, ...tagColumns(t, mark) }))),
    () => orGone(async () => tagDef(await call(s, `${TAGS}/${id}`)))),
  /** Conflict: the new name is taken. Gone: the definition has gone. */
  update: async (s: RecordTransport, rec: string, t: TagFields, mark?: TagMark): Promise<TagDef> =>
    tagDef(await call(s, `${TAGS}/${rec}`, json("PATCH", tagColumns(t, mark)))),
  /** A definition gone (the notes keep the tag). Already gone is done. */
  async remove(s: RecordTransport, rec: string): Promise<void> {
    await orGone(() => call(s, `${TAGS}/${rec}`, { method: "DELETE" }));
  },
  /** Renames the tag `from` to `to` on every note, task, lens and its definition, in one transaction on the server; a `to`
   *  already defined (case and tonos ignored) merges the two. */
  rename: (s: RecordTransport, from: string, to: string): Promise<Renamed> =>
    call(s, "tefnotes/tags/rename", { ...json("POST", { from, to }), timeout: RENAME_MS }),
  /** A description written from the notes that carry the tag `name`: not saved, the editor shows it. */
  describe: async (s: RecordTransport, name: string): Promise<string> =>
    (await call(s, "tefnotes/tags/describe", { ...json("POST", { tag: name }), timeout: DESCRIBE_MS })).description,
  /** A description for every tag that has a note, by name. A tag the model failed on is left out; a failure of the whole is
   *  Refused with the server's words (no note carries a tag, no key, the model failed). */
  describeAll: (s: RecordTransport): Promise<Described[]> =>
    call(s, "tefnotes/tags/describe", { ...json("POST", { all: true }), timeout: DESCRIBE_ALL_MS }),
  /** The tags JEV gives a task with this title and notes, likeliest first (core/tags.ts tagGuesser asks it). */
  async guess(s: RecordTransport, draft: { title: string; notes: string }, signal: AbortSignal): Promise<string[]> {
    const j = await call(s, "tefnotes/tags/guess", { ...json("POST", draft), timeout: GUESS_MS, signal });
    return Array.isArray(j?.tags) ? j.tags.filter((t: unknown): t is string => typeof t === "string") : [];
  },
};

// ---- attachments

const ATTACHMENTS = "collections/attachments/records";
const photo = (r: any): Photo => ({ rec: r.id, note: r.note, name: r.name, file: r.file });

/** The `attachments` collection: a note's photos, PDFs and drawings, each a record under the note's id (photos.ts), made and
 *  deleted, never edited. */
export const attachments = {
  /** Every attachment's record, or one note's, in the order they were added. */
  list: async (s: RecordTransport, note?: string): Promise<Photo[]> =>
    sorted(await every(s, ATTACHMENTS, { fields: "id,note,name,file,created", filter: note ? `note = ${lit(note)}` : undefined }), "created").map(photo),
  /** A file up under `note` as `name`. Conflict: the note has one by that name already. */
  async upload(s: RecordTransport, note: string, name: string, file: Blob): Promise<Photo> {
    const form = new FormData();
    form.append("note", note);
    form.append("name", name);
    form.append("file", file, name);
    return photo(await call(s, ATTACHMENTS, { method: "POST", body: form }));
  },
  /** An attachment gone. Already gone is done. */
  async remove(s: RecordTransport, rec: string): Promise<void> {
    await orGone(() => call(s, `${ATTACHMENTS}/${rec}`, { method: "DELETE" }));
  },
};

// ---- chats

const CHATS = "collections/chats/records";
const LISTED = "id,title,updated";

/** A chat as the list shows it. */
export type ChatLine = { id: string; title: string; updated: string };
/** A chat with its history and the rev its next save names. */
export type Chat = ChatLine & StoredChat;
const line = (r: any): ChatLine => ({ id: String(r.id), title: r.title ?? "", updated: r.updated ?? "" });

/** The `chats` collection (pb_migrations/1792600000_chats.js): a client makes a chat empty before its first message and names it
 *  in the request; from then on the agent is the one writer of its history, title and model, each save naming the rev the last
 *  one left (pb_hooks/rev.pb.js). */
export const chats = {
  /** The saved chats, newest activity first. */
  list: async (s: RecordTransport): Promise<ChatLine[]> => sorted(await every(s, CHATS, { fields: LISTED }), "-updated").map(line),
  /** One chat, its history read by chatOf (any version chat-history.ts reads); null when there is none. Throws ChatHistoryError
   *  on a history it can't read. */
  get: (s: RecordTransport, id: string): Promise<Chat | null> => orGone(async () => {
    const r = await call(s, `${CHATS}/${encodeURIComponent(id)}?fields=${CHAT_FIELDS},title,updated`);
    return { ...line(r), ...chatOf(r) };
  }),
  /** An empty chat under the client's `id`, so the first send has a record to name: sent again when no answer came, never twice. */
  create: (s: RecordTransport, id: string, title: string): Promise<ChatLine> => createdUnder(
    async () => line(await call(s, `${CHATS}?fields=${LISTED}`, json("POST", { id, title, ...serializeChatHistory([]) }))),
    () => chats.get(s, id)),
  /** The agent's save of chat `id`'s history, title and model over the version `rev`; the rev the save left. Conflict: another
   *  save landed since; Gone: the chat was deleted. */
  save: async (s: RecordTransport, id: string, rev: number, c: { messages: unknown; title: string; model: string }): Promise<number> =>
    (await call(s, `${CHATS}/${encodeURIComponent(id)}?fields=rev`, json("PATCH", { ...serializeChatHistory(c.messages), title: c.title, model: c.model, rev }))).rev,
  /** A chat gone (it names no rev: the owner's delete wins). Already gone is done. */
  async remove(s: RecordTransport, id: string): Promise<void> {
    await orGone(() => call(s, `${CHATS}/${encodeURIComponent(id)}`, { method: "DELETE" }));
  },
};
