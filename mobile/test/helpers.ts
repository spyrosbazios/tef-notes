/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNote } from "@/core/notes";
import type * as Db from "../src/store/db";

/** A file of the repo around the app (notes/, agent/), read-only; null when this checkout hasn't got it. */
export const repoFile = (p: string) => { const f = resolve(__dirname, "../..", p); return existsSync(f) ? readFileSync(f, "utf8") : null; };

/** A clock on one day of October 2026, local time: `on(3)(9, 30)` is the 3rd at 09:30; a third argument picks another day. */
export const on = (day: number) => (h: number, m = 0, d = day) => new Date(2026, 9, d, h, m).getTime() / 1000;

const unsent = (n: Db.NoteRow) => n.pushed !== n.updated;
const copy = <T>(x: T): T => structuredClone(x);

/** src/store/db.ts over two Maps, for the sync tests: same contract, no SQL. Search is a substring scan. */
export function fakeDb() {
  const notes = new Map<string, Db.NoteRow>(), atts = new Map<string, Db.AttachmentRow>(), recs = new Map<string, Db.RecordRow>();
  const links = new Map<string, Db.LinkRow>();                     // insertion order: oldest first, as the table's rowid
  const rk = (coll: Db.Coll, id: string) => `${coll}/${id}`;
  const rows = (coll: Db.Coll) => [...recs.values()].filter((r) => r.coll === coll);
  const recDirty = (r: Db.RecordRow) => r.pushed !== r.updated;
  const meta = (n: Db.NoteRow): Db.MetaRow => ({
    path: n.path, id: n.id, title: n.title, created: n.created, pinned: n.pinned, color: n.color, tags: n.tags,
    kind: n.kind, snippet: n.snippet, updated: n.updated, pushed: n.pushed, conflict: n.conflict_rev != null, lost: n.lost != null,
  });
  const live = () => [...notes.values()].filter((n) => !n.deleted);
  const api: typeof Db = {
    fts: false,
    getNote: (p) => (notes.has(p) ? copy(notes.get(p)!) : null),
    putNote: (row) => void notes.set(row.path, copy(row)),
    patchNote: (p, part) => { const n = notes.get(p); if (n) notes.set(p, { ...n, ...copy(part) }); return !!n; },
    deleteNote: (p) => void notes.delete(p),
    allMeta: () => live().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated).map(meta),
    getBody: (p) => { const n = notes.get(p); return n && !n.deleted ? parseNote(p, n.text).body : null; },
    noteRec: (p) => { const n = notes.get(p); return n && !n.deleted ? n.rec : null; },
    pathOfRec: (rec) => live().find((n) => n.rec === rec)?.path ?? null,
    getMeta: (p) => { const n = notes.get(p); return n && !n.deleted ? meta(n) : null; },
    allPaths: () => [...notes.keys()],
    dirtyPaths: () => live().filter(unsent).sort((a, b) => a.updated - b.updated).map((n) => n.path),
    tombstones: () => [...notes.values()].filter((n) => n.deleted).map(copy),
    syncState: () => [...notes.values()].map((n) => ({ path: n.path, rev: n.rev, dirty: unsent(n), deleted: n.deleted, conflict: n.conflict_rev != null, kind: n.kind })),
    search: (q) => live().filter((n) => n.text.toLowerCase().includes(q.toLowerCase())).map((n) => ({ path: n.path, title: n.title, snippet: n.snippet, rank: -1 })),
    getAttachment: (id, name) => copy(atts.get(`${id}/${name}`) ?? null),
    getAttachments: (id) => [...atts.values()].filter((a) => a.note_id === id).map(copy),
    allAttachments: () => [...atts.values()].map(copy),
    putAttachment: (a) => void atts.set(`${a.note_id}/${a.name}`, copy(a)),
    patchAttachment: (id, name, part) => { const a = atts.get(`${id}/${name}`); if (a) Object.assign(a, part); return !!a; },
    deleteAttachment: (id, name) => void atts.delete(`${id}/${name}`),
    getRecord: <T>(coll: Db.Coll, id: string) => copy((recs.get(rk(coll, id)) as Db.RecordRow<T> | undefined) ?? null),
    putRecord: (row) => void recs.set(rk(row.coll, row.id), copy(row) as Db.RecordRow),
    patchRecord: (coll, id, part) => { const r = recs.get(rk(coll, id)); if (r) recs.set(rk(coll, id), { ...r, ...copy(part) } as Db.RecordRow); return !!r; },
    deleteRecord: (coll, id) => void recs.delete(rk(coll, id)),
    allRecords: <T>(coll: Db.Coll) => rows(coll).filter((r) => !r.deleted).map(copy) as Db.RecordRow<T>[],
    dirtyRecords: <T>(coll: Db.Coll) => rows(coll).filter((r) => !r.deleted && recDirty(r)).sort((a, b) => a.updated - b.updated).map(copy) as Db.RecordRow<T>[],
    recordTombstones: <T>(coll: Db.Coll) => rows(coll).filter((r) => r.deleted).map(copy) as Db.RecordRow<T>[],
    recordStates: (coll) => rows(coll).map((r) => ({ id: r.id, rev: r.rev, dirty: recDirty(r), deleted: r.deleted })),
    getLink: (id) => copy(links.get(id) ?? null),
    putLink: (row) => void links.set(row.link.id, copy(row)),
    deleteLink: (id) => void links.delete(id),
    linkRows: () => [...links.values()].map(copy),
  };
  return { ...api, notes, atts, recs, links, reset: () => { notes.clear(); atts.clear(); recs.clear(); links.clear(); } };
}

/** The one fake behind `vi.mock("@/store/db", …)`: the test and the store see the same rows. */
export const fake = fakeDb();

/** src/store/storage.ts over Maps (MMKV is native): `vi.mock("@/store/storage", async () => (await import("./helpers")).fakeStorage)`. Every
 *  file is a fresh in-memory one, so a persisted store (prefs, lenses) starts empty. */
const memory = () => {
  const m = new Map<string, string>();
  return { getString: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k) };
};
const files = (id: string) => {
  const mmkv = memory();
  return { mmkv, id, storage: { getItem: (k: string) => mmkv.getString(k) ?? null, setItem: mmkv.set, removeItem: mmkv.remove } };
};
export const fakeStorage = {
  mmkvStorage: files,
  cache: memory(),
  previewFile: memory(),
  zustandPrefs: files("prefs").storage,
};
