// Collection protocol shared by fetch and axios. The injected transport owns I/O, retries,
// error types and connectivity; this module owns records, pagination and write semantics.
import { noteKindOf } from "./notes";
import { Conflict, lit, noteColumns, type Entry, type Listed, type Mark, type RevEntry, type Versioned } from "./record-contracts";
import { LINK_COLUMNS, linkOf, linkColumn, linkRecord, sameLink, type Link, type LinkEnd, type LinkSide } from "./record-links";

export type RecordRequest = { method?: string; body?: unknown; timeout?: number };
export type RecordTransport = {
  request(path: string, request?: RecordRequest): Promise<any>;
  status(error: unknown): number | undefined;
};
const call = (s: RecordTransport, path: string, request?: RecordRequest) => s.request(path, request);
const json = (method: string, body: unknown): RecordRequest => ({ method, body });
const PAGE = 500;

/** A note reader may retain client-specific fields. Filtering the sync listing is a client policy. */
export function noteCollection<T>(s: RecordTransport, of: (r: any) => T, options: { fields?: string; filter?: string; sort?: string } = {}) {
  const records = "collections/notes/records";
  const fields = options.fields ? `fields=${options.fields}&` : "";
  const at = (id: string) => `${records}/${id}${options.fields ? `?fields=${options.fields}` : ""}`;
  const nullable = async (run: () => Promise<T>): Promise<T | null> => {
    try { return await run(); } catch (e) { if (s.status(e) === 404) return null; throw e; }
  };
  return {
    async list(): Promise<Listed[]> {
      const out: Listed[] = [];
      const filter = options.filter ? `&filter=${encodeURIComponent(options.filter)}` : "";
      const sort = options.sort ? `&sort=${encodeURIComponent(options.sort)}` : "";
      for (let page = 1; ; page++) {
        const j = await call(s, `${records}?fields=id,path,rev,kind&perPage=${PAGE}&page=${page}&skipTotal=1${sort}${filter}`);
        out.push(...j.items.map((r: any) => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind) })));
        if (j.items.length < PAGE) return out;
      }
    },
    get: (id: string) => nullable(async () => of(await call(s, at(id)))),
    async read(path: string, timeout?: number): Promise<T | null> {
      const j = await call(s, `${records}?${fields}filter=${encodeURIComponent(`path = ${lit(path)}`)}&perPage=1&skipTotal=1`, { timeout });
      return j.items.length ? of(j.items[0]) : null;
    },
    create: async (path: string, text: string, mark: Mark = {}): Promise<T> =>
      of(await call(s, `${records}${options.fields ? `?fields=${options.fields}` : ""}`, json("POST", { ...noteColumns(path, text), ...mark }))),
    update: (e: Entry, text: string, mark: Mark = {}) => nullable(async () =>
      of(await call(s, at(e.rec), json("PATCH", { ...noteColumns(e.path, text), rev: e.rev, ...mark })))),
    async remove(e: Pick<Entry, "rec" | "rev">): Promise<void> {
      try { await call(s, `${records}/${e.rec}?rev=${e.rev}`, { method: "DELETE" }); }
      catch (err) { if (s.status(err) !== 404) throw err; }
    },
  };
}

const ID_BATCH = 40;

/** The calls for one collection under the rev contract (server/pb_hooks/rev.pb.js), its records read by `of`. */
export function revCollection<T extends { id: string }>(name: string, of: (r: any) => T) {
  const rec = (r: any): Versioned<T> => ({ ...of(r), rev: r.rev });
  const records = `collections/${name}/records`;
  const paged = async (s: RecordTransport, q: string): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const j = await call(s, `${records}?${q}&perPage=${PAGE}&page=${page}&skipTotal=1`);
      out.push(...j.items);
      if (j.items.length < PAGE) return out;
    }
  };
  return {
    rec,
    /** Every record's id and rev, nothing else. */
    revs: async (s: RecordTransport): Promise<RevEntry[]> => (await paged(s, "fields=id,rev&sort=id")).map((r) => ({ id: r.id, rev: r.rev })),
    /** Every record, or those a PocketBase `filter` picks (build literals with lit), in `sort` order (`order`, `-done`). */
    list: async (s: RecordTransport, o: { filter?: string; sort?: string } = {}): Promise<Versioned<T>[]> =>
      (await paged(s, [o.filter ? `filter=${encodeURIComponent(o.filter)}` : "", `sort=${encodeURIComponent(o.sort ?? "order")}`].filter(Boolean).join("&"))).map(rec),
    /** One record; null when there's none. */
    async get(s: RecordTransport, id: string): Promise<Versioned<T> | null> {
      try { return rec(await call(s, `${records}/${id}`)); } catch (e) { if (s.status(e) === 404) return null; throw e; }
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
      try { return rec(await call(s, `${records}/${id}`, json("PATCH", { ...fields, id: undefined, rev, ...mark }))); } catch (e) { if (s.status(e) === 404) return null; throw e; }
    },
    /** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
    async remove(s: RecordTransport, id: string, rev: number): Promise<void> {
      try { await call(s, `${records}/${id}?rev=${rev}`, { method: "DELETE" }); } catch (e) { if (s.status(e) !== 404) throw e; }
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
    const out: Link[] = [], f = filter ? `&filter=${encodeURIComponent(filter)}` : "";
    for (let page = 1; ; page++) {
      const j = await call(s, `collections/links/records?fields=${LINK_FIELDS}&sort=created,id&perPage=${PAGE}&page=${page}&skipTotal=1${f}`);
      for (const r of j.items) { const l = linkOf(r); if (l) out.push(l); }
      if (j.items.length < PAGE) return out;
    }
  },
  /** Every link's id: what a pull compares a phone's set against (an id never changes what it points at). */
  async ids(s: RecordTransport): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; ; page++) {
      const j = await call(s, `collections/links/records?fields=id&sort=id&perPage=${PAGE}&page=${page}&skipTotal=1`);
      out.push(...j.items.map((r: any) => String(r.id)));
      if (j.items.length < PAGE) return out;
    }
  },
  /** The links with `end` at either side: a note's, both what it points at and what points at it (its backlinks). */
  of: (s: RecordTransport, end: LinkEnd) => links.list(s, `${linkFilter("from", end)} || ${linkFilter("to", end)}`),
  /** The links with `end` as their `from`. */
  from: (s: RecordTransport, end: LinkEnd) => links.list(s, linkFilter("from", end)),
  /** The links with `end` as their `to`: what points at it. */
  to: (s: RecordTransport, end: LinkEnd) => links.list(s, linkFilter("to", end)),
  /** `l` made (newLink names it). Idempotent: one the server has by that id, or another of the same ends and role, is the
   *  link meant, and comes back as the server holds it (a phone keeps the server's id). HttpError 404 is an end that is
   *  gone; any other 400 a link the server refuses. */
  async add(s: RecordTransport, l: Link): Promise<Link> {
    try { return linkOf(await call(s, `collections/links/records?fields=${LINK_FIELDS}`, json("POST", linkRecord(l)))) ?? l; } catch (e) {
      if (!(e instanceof Conflict) && s.status(e) !== 400) throw e;
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
    try { await call(s, `collections/links/records/${id}`, { method: "DELETE" }); } catch (e) {
      if (s.status(e) === 404) return;
      throw e;
    }
  },
};
