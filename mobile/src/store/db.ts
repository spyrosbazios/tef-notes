// Note bodies and sync state in SQLite, one row per repo file: the zustand index (store/notes.ts) holds
// only the list, so thousands of notes cost no memory until one opens. Everything here is rebuildable
// from the notes server. Search is FTS5 over a folded copy of title and body: unicode61's remove_diacritics strips
// Latin accents but not Greek tonos, and Greek gets typed without them. snippet() reads the original
// text back from `notes` (external content), so results show the note as written.
import { openDatabaseSync } from "expo-sqlite";
import { fold, HIT, matchQuery, noteKindOf, parseNote, plainText, type Color, type NoteKind } from "@/core/notes";
import { linkOf, linkRecord, type Link } from "@/core/record-links";

export type NoteRow = {
  path: string;
  id: string;
  text: string;                 // the whole file, frontmatter and all
  title: string;
  created: string;
  pinned: boolean;
  color: Color | null;
  tags: string[];
  kind: NoteKind;               // its record's `kind` (core/notes.ts), the server's; `note` for one made here
  snippet: string;
  updated: number;              // ms of the last local change; only moves forward
  pushed: number | null;        // `updated` as of the last push or pull: differs = unsent edits
  rec: string | null;           // the server's record id; null until first pushed
  rev: number | null;           // the server's version this text was last in step with
  base: string | null;          // that version's text: what both sides' edits are diffed against
  conflict_text: string | null; // the server's version while unsent edits overlap it; the user picks a side
  conflict_rev: number | null;
  lost: string | null;          // the unsent text "Use the server's" replaced, until restored or dismissed
  deleted: boolean;             // tombstone until the delete is pushed
};

/** A row for the list: no text. */
export type MetaRow = Pick<NoteRow, "path" | "id" | "title" | "created" | "pinned" | "color" | "tags" | "kind" | "snippet" | "updated" | "pushed">
  & { conflict: boolean; lost: boolean };

export type SyncRow = { path: string; rev: number | null; dirty: boolean; deleted: boolean; conflict: boolean; kind: NoteKind };

/** A photo a note's body shows as `../attachments/<note_id>/<name>`. `rec`, `file`: its server record and stored file,
 *  null = added here, not uploaded yet. `local`: a file:// copy on the phone, null until fetched. `pushed`: when the
 *  server last had it (ms). */
export type AttachmentRow = { note_id: string; name: string; rec: string | null; file: string | null; local: string | null; size: number | null; pushed: number | null };

export type Hit = { path: string; title: string; snippet: string; rank: number };

/** The records synced beside the notes (core/todo.ts). */
export type Coll = "tasks";

/** A task as the phone holds it. `data`: its fields now; `base`: as of `rev`, the server's version it was
 *  last in step with (null until first pushed or pulled), what a merge diffs against. `updated`/`pushed` as a note's:
 *  differ = unsent edits. `deleted`: a tombstone until the delete is pushed. */
export type RecordRow<T = unknown> = { coll: Coll; id: string; data: T; base: T | null; rev: number | null; updated: number; pushed: number | null; deleted: boolean };

/** A link between records (core/record-links.ts) as the phone holds it. `pushed`: when the server last had it (ms), null for
 *  one made here and not yet up. `deleted`: a tombstone until the delete is pushed. No rev: a link is never edited. */
export type LinkRow = { link: Link; pushed: number | null; deleted: boolean };

/** What a pull compares against the server's listing. */
export type RecordState = { id: string; rev: number | null; dirty: boolean; deleted: boolean };

const COLS = ["path", "id", "text", "title", "created", "pinned", "color", "tags", "kind", "snippet", "updated", "pushed",
  "rec", "rev", "base", "conflict_text", "conflict_rev", "lost", "deleted"] as const;
const META = "path, id, title, created, pinned, color, tags, kind, snippet, updated, pushed, conflict_rev IS NOT NULL AS conflict, lost IS NOT NULL AS lost";
const ATT_COLS = ["note_id", "name", "rec", "file", "local", "size", "pushed"] as const;

// One entry per schema version, run in order from PRAGMA user_version. Append, never edit. `rid`: an
// explicit rowid, since VACUUM may renumber implicit ones and notes_fts points at it. A function: a step SQL alone
// can't take (it reads the notes' text).
const MIGRATIONS: (string | (() => void))[] = [
  `CREATE TABLE notes (
    rid INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    id TEXT NOT NULL,
    text TEXT NOT NULL,
    title TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    sticky INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    snippet TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL,
    pushed INTEGER,
    sha TEXT,
    base TEXT,
    conflict_text TEXT,
    conflict_sha TEXT,
    lost TEXT,
    why TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    ft_title TEXT NOT NULL DEFAULT '',
    ft_body TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX notes_list ON notes (deleted, pinned DESC, updated DESC);
  CREATE TABLE attachments (
    note_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sha TEXT,
    local TEXT,
    size INTEGER,
    pushed INTEGER,
    PRIMARY KEY (note_id, name)
  );`,
  // GitHub → the notes server: git shas mean nothing to it, so the cache starts over and the first sync refills it.
  // Unsent edits go with it — the app says to sync before updating. The FTS index goes too: it's rebuilt at open.
  `DROP TABLE IF EXISTS notes_fts;
  DROP TABLE notes;
  DROP TABLE attachments;
  CREATE TABLE notes (
    rid INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    id TEXT NOT NULL,
    text TEXT NOT NULL,
    title TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    sticky INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    snippet TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL,
    pushed INTEGER,
    rec TEXT,
    rev INTEGER,
    base TEXT,
    conflict_text TEXT,
    conflict_rev INTEGER,
    lost TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    ft_title TEXT NOT NULL DEFAULT '',
    ft_body TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX notes_list ON notes (deleted, pinned DESC, updated DESC);
  CREATE TABLE attachments (
    note_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rec TEXT,
    file TEXT,
    local TEXT,
    size INTEGER,
    pushed INTEGER,
    PRIMARY KEY (note_id, name)
  );`,
  // The server's tag suggestions, filled by each pull; version 13 drops the column (the server adds every tag it picks).
  `ALTER TABLE notes ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]';`,
  // Version 4 was a one-shot snippet refill, run on the phone and removed: its slot stays so later versions keep their numbers.
  () => {},
  // Versions 5 and 6 indexed each note's tasks from its text into a `tasks` column; their fill ran and was removed with
  // the note-based tasks (version 8 drops the column). The column stays here so version 8 finds it on a fresh install.
  `ALTER TABLE notes ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]';`,
  () => {},
  // Tasks as records of their own (store/todo.ts): their fields as JSON, synced like a note's text.
  `CREATE TABLE records (
    coll TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    base TEXT,
    rev INTEGER,
    updated INTEGER NOT NULL,
    pushed INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (coll, id)
  );`,
  // Tasks left note text for records (version 7): the notes' tasks column goes.
  `ALTER TABLE notes DROP COLUMN tasks;`,
  // The Sticky page went; a colour is the list card's tint alone. The flag goes from the cache with it.
  `ALTER TABLE notes DROP COLUMN sticky;`,
  // A note's kind (core/notes.ts NoteKind) is its record's column now, not its path: the next pull's listing fills it in.
  `ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';`,
  // Links between records (store/todo.ts), synced as a set of ids: the link's columns as JSON.
  `CREATE TABLE links (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    pushed INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0
  );`,
  // Projects went (tasks stand alone): their rows go, and a task's project and heading with them.
  `DELETE FROM records WHERE coll = 'projects';
  UPDATE records SET data = json_remove(data, '$.project', '$.heading'), base = json_remove(base, '$.project', '$.heading') WHERE coll = 'tasks';`,
  // The server adds every tag it picks, suggesting none: the notes' suggestions column goes, and a task's with it.
  `ALTER TABLE notes DROP COLUMN suggested;
  UPDATE records SET data = json_remove(data, '$.suggested'), base = json_remove(base, '$.suggested') WHERE coll = 'tasks';`,
];

// Outside the migrations: FTS5 can be missing from a build, and is created as soon as it isn't.
// The index holds ft_title/ft_body (folded); the content table's title/body are what snippet() shows.
const FTS = `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, content = 'notes', content_rowid = 'rid',
  tokenize = 'unicode61 remove_diacritics 2')`;
const TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.rid, new.ft_title, new.ft_body);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.rid, old.ft_title, old.ft_body);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF ft_title, ft_body ON notes
  WHEN old.ft_title IS NOT new.ft_title OR old.ft_body IS NOT new.ft_body BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.rid, old.ft_title, old.ft_body);
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.rid, new.ft_title, new.ft_body);
  END;`;

const db = openDatabaseSync("tefnotes.db");
db.execSync("PRAGMA journal_mode = WAL");
for (let v = db.getFirstSync<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0; v < MIGRATIONS.length; v++) {
  const step = MIGRATIONS[v];
  db.withTransactionSync(() => { if (typeof step === "string") db.execSync(step); else step(); db.execSync(`PRAGMA user_version = ${v + 1}`); });
}
/** Whether this build's SQLite has FTS5. Checked once at open; without it search is LIKE over the folded copy. */
export const fts = (() => {
  const had = !!db.getFirstSync("SELECT 1 FROM sqlite_master WHERE name = 'notes_fts'");
  try { db.execSync(FTS); } catch { return false; }
  db.withTransactionSync(() => {
    db.execSync(TRIGGERS);
    if (!had) db.execSync("INSERT INTO notes_fts (rowid, title, body) SELECT rid, ft_title, ft_body FROM notes");
  });
  return true;
})();

type Value = string | number | null;
type Raw = Record<string, Value>;

const listOf = (s: Value): unknown[] => { try { const t = JSON.parse(String(s ?? "[]")); return Array.isArray(t) ? t : []; } catch { return []; } };
const tagsOf = (s: Value) => listOf(s).map(String);

function fromRaw(r: Raw): NoteRow {
  return {
    path: r.path as string, id: r.id as string, text: r.text as string, title: r.title as string, created: (r.created as string) ?? "",
    pinned: !!r.pinned, color: (r.color as Color) ?? null, tags: tagsOf(r.tags), kind: noteKindOf(r.kind), snippet: (r.snippet as string) ?? "",
    updated: r.updated as number, pushed: (r.pushed as number) ?? null, rec: (r.rec as string) ?? null, rev: (r.rev as number) ?? null,
    base: (r.base as string) ?? null, conflict_text: (r.conflict_text as string) ?? null, conflict_rev: (r.conflict_rev as number) ?? null,
    lost: (r.lost as string) ?? null, deleted: !!r.deleted,
  };
}

/** Columns → SQL values, plus what search reads: the body, and folded title and body. */
function toDb(path: string, p: Partial<NoteRow>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(COLS as readonly string[]).includes(k) || k === "path") continue;
    out[k] = typeof v === "boolean" ? (v ? 1 : 0) : k === "tags" ? JSON.stringify(v ?? []) : ((v as Value | undefined) ?? null);
  }
  if (p.text != null) { const body = parseNote(path, p.text).body; out.body = body; out.ft_body = fold(body); }
  if (p.title != null) out.ft_title = fold(p.title);
  return out;
}

export function getNote(path: string): NoteRow | null {
  const r = db.getFirstSync<Raw>(`SELECT ${COLS.join(", ")} FROM notes WHERE path = ?`, [path]);
  return r ? fromRaw(r) : null;
}

/** A note's server record id (what a task's `note` holds); null while it has never been pushed, or there is no such note. */
export const noteRec = (path: string): string | null =>
  db.getFirstSync<{ rec: string | null }>("SELECT rec FROM notes WHERE path = ? AND deleted = 0", [path])?.rec ?? null;

/** The note a server record id is, as the phone has it; null when it isn't on this phone. */
export const pathOfRec = (rec: string): string | null =>
  db.getFirstSync<{ path: string }>("SELECT path FROM notes WHERE rec = ? AND deleted = 0", [rec])?.path ?? null;

/** A note's body as the index holds it (no frontmatter); null when there is no such note. */
export const getBody = (path: string): string | null =>
  db.getFirstSync<{ body: string }>("SELECT body FROM notes WHERE path = ? AND deleted = 0", [path])?.body ?? null;

/** Insert or replace the whole row. An upsert, not REPLACE: the rowid stays and the update trigger reindexes. */
export function putNote(row: NoteRow): void {
  const v = toDb(row.path, row), cols = Object.keys(v);
  db.runSync(
    `INSERT INTO notes (path, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})
     ON CONFLICT (path) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
    [row.path, ...cols.map((c) => v[c])],
  );
}

/** Set some columns of one row; false when there's no such row. */
export function patchNote(path: string, p: Partial<Omit<NoteRow, "path">>): boolean {
  const v = toDb(path, p), cols = Object.keys(v);
  if (!cols.length) return !!getNote(path);
  return db.runSync(`UPDATE notes SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE path = ?`, [...cols.map((c) => v[c]), path]).changes > 0;
}

/** Gone for good: the row and its search entry. A delete to push is a tombstone (`deleted`) instead. */
export function deleteNote(path: string): void {
  db.runSync("DELETE FROM notes WHERE path = ?", [path]);
}

const metaOf = (r: Raw): MetaRow => {
  const n = fromRaw({ ...r, text: "" });
  return { path: n.path, id: n.id, title: n.title, created: n.created, pinned: n.pinned, color: n.color, tags: n.tags,
    kind: n.kind, snippet: n.snippet, updated: n.updated, pushed: n.pushed, conflict: !!r.conflict, lost: !!r.lost };
};

/** The list: every row but tombstones, pinned first, then the latest changed. */
export const allMeta = (): MetaRow[] => db.getAllSync<Raw>(`SELECT ${META} FROM notes WHERE deleted = 0 ORDER BY pinned DESC, updated DESC`).map(metaOf);

export const getMeta = (path: string): MetaRow | null => {
  const r = db.getFirstSync<Raw>(`SELECT ${META} FROM notes WHERE path = ? AND deleted = 0`, [path]);
  return r ? metaOf(r) : null;
};

/** Every path, tombstones included: what a new note's path must not take. */
export const allPaths = (): string[] => db.getAllSync<{ path: string }>("SELECT path FROM notes").map((r) => r.path);

const DIRTY = "(pushed IS NULL OR pushed <> updated)";

/** Rows with unsent edits, oldest first. */
export const dirtyPaths = (): string[] =>
  db.getAllSync<{ path: string }>(`SELECT path FROM notes WHERE deleted = 0 AND ${DIRTY} ORDER BY updated`).map((r) => r.path);

/** Deletes waiting to be pushed. */
export const tombstones = (): NoteRow[] => db.getAllSync<Raw>(`SELECT ${COLS.join(", ")} FROM notes WHERE deleted = 1`).map(fromRaw);

/** What a pull compares against the server's listing, for every row: no text. */
export const syncState = (): SyncRow[] =>
  db.getAllSync<Raw>(`SELECT path, rev, deleted, ${DIRTY} AS dirty, conflict_rev IS NOT NULL AS conflict, kind FROM notes`)
    .map((r) => ({ path: r.path as string, rev: (r.rev as number) ?? null, dirty: !!r.dirty, deleted: !!r.deleted, conflict: !!r.conflict,
      kind: noteKindOf(r.kind) }));

// ---- search

/** Notes matching `query`, best first: title, a snippet with the match between HIT marks, bm25 rank
 *  (lower is better; title hits weigh 5x). Only notes/: agent/memory.md isn't one. A word may also be in a note's
 *  tags, so `keys home` finds a note with "keys" in its text and the tag `home`: those come after the text matches. */
export function search(query: string, limit = 50): Hit[] {
  const base = textSearch(query, limit), terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return base;
  const tagged = db.getAllSync<{ path: string; title: string; snippet: string; tags: string }>(
    "SELECT path, title, snippet, tags FROM notes WHERE deleted = 0 AND path LIKE 'notes/%' AND tags <> '[]' ORDER BY updated DESC",
  ).map((r) => ({ ...r, folded: tagsOf(r.tags).map(fold) }));
  const inTags = (r: { folded: string[] }, t: string) => r.folded.some((x) => x.includes(t));
  const near = tagged.filter((r) => terms.some((t) => inTags(r, t)));
  if (!near.length) return base;
  const have = new Set(base.map((h) => h.path)), text = terms.map((t) => new Set(textSearch(t, 5000).map((h) => h.path)));
  const extra = near.filter((r) => !have.has(r.path) && terms.every((t, i) => inTags(r, t) || text[i].has(r.path)));
  return [...base, ...extra.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet, rank: 0 }))].slice(0, limit);
}

function textSearch(query: string, limit: number): Hit[] {
  const q = query.trim();
  if (!q) return [];
  const m = matchQuery(q);
  if (m && fts) {
    try {
      return db.getAllSync<Hit>(
        `SELECT n.path AS path, n.title AS title, snippet(notes_fts, 1, ?, ?, '…', 16) AS snippet, bm25(notes_fts, 5.0, 1.0) AS rank
         FROM notes_fts JOIN notes n ON n.rid = notes_fts.rowid
         WHERE notes_fts MATCH ? AND n.deleted = 0 AND n.path LIKE 'notes/%' ORDER BY rank LIMIT ?`,
        [HIT[0], HIT[1], m, limit],
      ).map((h) => ({ ...h, snippet: plainText(h.snippet) }));
    } catch { /* a query FTS5 still won't parse: LIKE below */ }
  }
  return like(q, limit);
}

const likeArg = (t: string) => `%${t.replace(/[\\%_]/g, "\\$&")}%`;

/** Every word somewhere in the folded title or body; title hits first, then the latest changed. */
function like(q: string, limit: number): Hit[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];                                    // only marks, which fold away: nothing to look for
  const where = terms.map(() => "(ft_title LIKE ? ESCAPE '\\' OR ft_body LIKE ? ESCAPE '\\')").join(" AND ");
  const rows = db.getAllSync<{ path: string; title: string; body: string; snippet: string; t: number }>(
    `SELECT path, title, body, snippet, ft_title LIKE ? ESCAPE '\\' AS t FROM notes
     WHERE deleted = 0 AND path LIKE 'notes/%' AND ${where} ORDER BY t DESC, updated DESC LIMIT ?`,
    [likeArg(terms[0]), ...terms.flatMap((t) => [likeArg(t), likeArg(t)]), limit],
  );
  return rows.map((r) => ({ path: r.path, title: r.title, snippet: around(r.body, terms[0]) ?? r.snippet, rank: r.t ? -2 : -1 }));
}

/** A window of the body as plain text around the first hit, marked like FTS5's snippet(). Folding keeps lengths for
 *  precomposed text, so the hit's offset in the folded copy is its offset in the original. null when the term is
 *  only in markup (a link's address): the note's own snippet shows instead. */
function around(body: string, term: string): string | null {
  const plain = plainText(body), folded = fold(plain), i = folded.indexOf(term);
  if (i < 0) return null;
  const src = folded.length === plain.length ? plain : folded, a = Math.max(0, i - 40), b = Math.min(src.length, i + term.length + 60);
  return `${a ? "…" : ""}${src.slice(a, i).trimStart()}${HIT[0]}${src.slice(i, i + term.length)}${HIT[1]}${src.slice(i + term.length, b).trimEnd()}${b < src.length ? "…" : ""}`;
}

// ---- attachments

const attOf = (r: Raw): AttachmentRow => ({
  note_id: r.note_id as string, name: r.name as string, rec: (r.rec as string) ?? null, file: (r.file as string) ?? null, local: (r.local as string) ?? null,
  size: (r.size as number) ?? null, pushed: (r.pushed as number) ?? null,
});

export const getAttachment = (noteId: string, name: string): AttachmentRow | null => {
  const r = db.getFirstSync<Raw>(`SELECT ${ATT_COLS.join(", ")} FROM attachments WHERE note_id = ? AND name = ?`, [noteId, name]);
  return r ? attOf(r) : null;
};

/** One note's photos, by name. */
export const getAttachments = (noteId: string): AttachmentRow[] =>
  db.getAllSync<Raw>(`SELECT ${ATT_COLS.join(", ")} FROM attachments WHERE note_id = ? ORDER BY name`, [noteId]).map(attOf);

export const allAttachments = (): AttachmentRow[] => db.getAllSync<Raw>(`SELECT ${ATT_COLS.join(", ")} FROM attachments`).map(attOf);

export function putAttachment(a: AttachmentRow): void {
  const vals = ATT_COLS.map((c) => a[c] ?? null);
  db.runSync(
    `INSERT INTO attachments (${ATT_COLS.join(", ")}) VALUES (${ATT_COLS.map(() => "?").join(", ")})
     ON CONFLICT (note_id, name) DO UPDATE SET ${ATT_COLS.slice(2).map((c) => `${c} = excluded.${c}`).join(", ")}`,
    vals,
  );
}

export function patchAttachment(noteId: string, name: string, p: Partial<Omit<AttachmentRow, "note_id" | "name">>): boolean {
  const cols = Object.keys(p).filter((c) => (ATT_COLS as readonly string[]).includes(c) && c !== "note_id" && c !== "name") as (keyof AttachmentRow)[];
  if (!cols.length) return !!getAttachment(noteId, name);
  return db.runSync(`UPDATE attachments SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE note_id = ? AND name = ?`,
    [...cols.map((c) => p[c as keyof typeof p] ?? null), noteId, name]).changes > 0;
}

export function deleteAttachment(noteId: string, name: string): void {
  db.runSync("DELETE FROM attachments WHERE note_id = ? AND name = ?", [noteId, name]);
}

// ---- tasks

const REC_COLS = "coll, id, data, base, rev, updated, pushed, deleted";
const REC_DIRTY = "(pushed IS NULL OR pushed <> updated)";
const json = (s: Value): unknown => (s == null ? null : JSON.parse(String(s)));

const recOf = <T>(r: Raw): RecordRow<T> => ({
  coll: r.coll as Coll, id: r.id as string, data: json(r.data) as T, base: json(r.base) as T | null, rev: (r.rev as number) ?? null,
  updated: r.updated as number, pushed: (r.pushed as number) ?? null, deleted: !!r.deleted,
});

export function getRecord<T>(coll: Coll, id: string): RecordRow<T> | null {
  const r = db.getFirstSync<Raw>(`SELECT ${REC_COLS} FROM records WHERE coll = ? AND id = ?`, [coll, id]);
  return r ? recOf<T>(r) : null;
}

/** Insert or replace the whole row. */
export function putRecord<T>(row: RecordRow<T>): void {
  db.runSync(
    `INSERT INTO records (${REC_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, base = excluded.base, rev = excluded.rev, updated = excluded.updated,
       pushed = excluded.pushed, deleted = excluded.deleted`,
    [row.coll, row.id, JSON.stringify(row.data), row.base == null ? null : JSON.stringify(row.base), row.rev, row.updated, row.pushed, row.deleted ? 1 : 0],
  );
}

/** Set some columns of one row; false when there's no such row. */
export function patchRecord<T>(coll: Coll, id: string, p: Partial<Omit<RecordRow<T>, "coll" | "id">>): boolean {
  const v: Record<string, Value> = {};
  for (const [k, x] of Object.entries(p)) {
    if (k === "data" || k === "base") v[k] = x == null ? null : JSON.stringify(x);
    else if (k === "deleted") v[k] = x ? 1 : 0;
    else if (k === "rev" || k === "updated" || k === "pushed") v[k] = (x as number | null) ?? null;
  }
  const cols = Object.keys(v);
  if (!cols.length) return !!getRecord(coll, id);
  return db.runSync(`UPDATE records SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE coll = ? AND id = ?`, [...cols.map((c) => v[c]), coll, id]).changes > 0;
}

/** Gone for good. A delete to push is a tombstone (`deleted`) instead. */
export function deleteRecord(coll: Coll, id: string): void {
  db.runSync("DELETE FROM records WHERE coll = ? AND id = ?", [coll, id]);
}

/** Every row but tombstones. */
export const allRecords = <T>(coll: Coll): RecordRow<T>[] =>
  db.getAllSync<Raw>(`SELECT ${REC_COLS} FROM records WHERE coll = ? AND deleted = 0`, [coll]).map((r) => recOf<T>(r));

/** Rows with unsent edits, oldest first. */
export const dirtyRecords = <T>(coll: Coll): RecordRow<T>[] =>
  db.getAllSync<Raw>(`SELECT ${REC_COLS} FROM records WHERE coll = ? AND deleted = 0 AND ${REC_DIRTY} ORDER BY updated`, [coll]).map((r) => recOf<T>(r));

/** Deletes waiting to be pushed. */
export const recordTombstones = <T>(coll: Coll): RecordRow<T>[] =>
  db.getAllSync<Raw>(`SELECT ${REC_COLS} FROM records WHERE coll = ? AND deleted = 1`, [coll]).map((r) => recOf<T>(r));

/** Every row's sync state, tombstones included: no data. */
export const recordStates = (coll: Coll): RecordState[] =>
  db.getAllSync<Raw>(`SELECT id, rev, deleted, ${REC_DIRTY} AS dirty FROM records WHERE coll = ?`, [coll])
    .map((r) => ({ id: r.id as string, rev: (r.rev as number) ?? null, dirty: !!r.dirty, deleted: !!r.deleted }));

// ---- links

const linkRowOf = (r: Raw): LinkRow | null => {
  const link = linkOf(json(r.data));
  return link ? { link, pushed: (r.pushed as number) ?? null, deleted: !!r.deleted } : null;
};

export function getLink(id: string): LinkRow | null {
  const r = db.getFirstSync<Raw>("SELECT data, pushed, deleted FROM links WHERE id = ?", [id]);
  return r ? linkRowOf(r) : null;
}

/** Insert or replace the whole row. */
export function putLink(row: LinkRow): void {
  db.runSync(
    `INSERT INTO links (id, data, pushed, deleted) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, pushed = excluded.pushed, deleted = excluded.deleted`,
    [row.link.id, JSON.stringify(linkRecord(row.link)), row.pushed, row.deleted ? 1 : 0],
  );
}

/** Gone for good. A delete to push is a tombstone (`deleted`) instead. */
export function deleteLink(id: string): void {
  db.runSync("DELETE FROM links WHERE id = ?", [id]);
}

/** Every row, tombstones included, oldest first. */
export const linkRows = (): LinkRow[] =>
  db.getAllSync<Raw>("SELECT data, pushed, deleted FROM links ORDER BY rowid").flatMap((r) => { const l = linkRowOf(r); return l ? [l] : []; });
