// The notes index and the sync engine. Bodies live in SQLite (db.ts); in memory only the list, one NoteMeta
// per file, and the sync state. The notes server (core/pocketbase.ts) is the source of truth: pull on launch,
// foreground and whenever the server says something this phone doesn't know yet (live.ts, heard), push a moment after
// the last write (typing saves 400 ms after the last key; the push waits longer, so it is a per-pause send, not a
// per-keystroke one), on leaving a note and on backgrounding. A pull is one listing of every record's rev (and the server's tag
// suggestions, which it writes without moving rev, and the note's kind, which a copy made before the phone kept it learns
// there) and a fetch per changed one. Both sides edited a file: disjoint edits merge against the last text in step (core/notes.ts
// reconcile); overlapping ones wait for the user to pick a side.
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import {
  ATTACHMENTS, isNotePath, MEMORY, newNotePath, noteIdOf, parseNote, reconcile, rewriteImagePaths, serializeNote, snippetOf, withFlags,
  type Color, type NoteKind,
} from "@/core/notes";
import { inheritTags, withinLens } from "@/core/lens";
import * as pb from "@/core/pocketbase";
import { localDay } from "@/core/time";
import { moveAttachments, syncAttachments } from "./attachments";
import * as db from "./db";
import { serverOf, useKeys } from "./keys";
import { activeLensNow, useActiveLens } from "./lenses";
import type { LiveEvent } from "./live";
import { failed, pool, tick, unreachable, type SyncState } from "./sync";

export type NoteMeta = {
  path: string;
  id: string;
  title: string;
  snippet: string;
  created: string;
  updated: number;
  pinned: boolean;
  color?: Color;
  tags: string[];
  kind: NoteKind;           // the record's kind (a note); the server sets it, never changed
  dirty: boolean;           // unsent edits
  conflict: boolean;        // the server moved on and the edits overlap: the user picks a side
  lost?: true;              // "Use the server's" replaced unsent text, kept to restore. Absent, not false, when none
};

/** What setFlags changes; a key left out stays as it is. `color: null` clears it. */
export type FlagPatch = { pinned?: boolean; color?: Color | null; tags?: string[] };

type S = {
  notes: Record<string, NoteMeta>;    // by path: every synced file, agent/memory.md included
  list: NoteMeta[];                   // notes/ only: pinned first, then the latest changed
  rev: Record<string, number>;        // bumped when a file's text changes: what useNoteText re-reads on
  moved: Record<string, string>;      // a note made here → the path it went up under, the laptop having taken its own (moveAside)
  sync: SyncState;
  write: (path: string, text: string) => void;
  /** A new note, its path picked from the title and today; returns the path. It carries the first tag of the lens that is on
   *  (core/lens.ts): only a note made here, never one the sync brings down. */
  create: (title: string, opts?: FlagPatch & { body?: string; now?: number }) => string;
  remove: (path: string) => void;
  /** Leaving a note just made, still as it was made (`made`, its text then: no word, flag or retitle since) and
   *  never pushed: it goes, as if never made. No sync of its own. */
  discardNew: (path: string, made: string) => void;
  setFlags: (path: string, flags: FlagPatch) => void;
  keepMine: (path: string) => void;
  takeTheirs: (path: string) => void;
  restore: (path: string) => void;
  discard: (path: string) => void;
};

export const dirty = (m?: NoteMeta) => !!m?.dirty;
const unsent = (n: db.NoteRow) => n.updated !== n.pushed;

const toMeta = (m: db.MetaRow): NoteMeta => ({
  path: m.path, id: m.id, title: m.title, snippet: m.snippet, created: m.created, updated: m.updated, pinned: m.pinned,
  ...(m.color ? { color: m.color } : {}), tags: m.tags, kind: m.kind, dirty: m.updated !== m.pushed, conflict: m.conflict, ...(m.lost ? { lost: true as const } : {}),
});
const order = (a: NoteMeta, b: NoteMeta) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated;
const listOf = (notes: Record<string, NoteMeta>) => Object.values(notes).filter((m) => isNotePath(m.path)).sort(order);

function index() {
  const notes = Object.fromEntries(db.allMeta().map((m) => [m.path, toMeta(m)]));
  return { notes, list: listOf(notes) };
}

/** The columns that follow from a file's text. */
function fieldsOf(path: string, text: string) {
  const n = parseNote(path, text);
  return { text, id: n.id, title: n.title, created: n.created, pinned: n.pinned, color: n.color ?? null, tags: n.tags,
    snippet: snippetOf(n.body) };
}

const fresh = (path: string, text: string, updated: number): db.NoteRow => ({
  path, ...fieldsOf(path, text), kind: "note", updated, pushed: null, rec: null, rev: null, base: null, conflict_text: null, conflict_rev: null, lost: null, deleted: false,
});

/** Re-read these rows into the index; `text`: their text changed, so open notes re-read it too. */
function refresh(paths: string[], text = true) {
  const s = useNotes.getState(), notes = { ...s.notes }, rev = text ? { ...s.rev } : s.rev;
  for (const p of paths) {
    const m = db.getMeta(p);
    if (m) notes[p] = toMeta(m); else delete notes[p];
    if (text) rev[p] = (rev[p] ?? 0) + 1;
  }
  useNotes.setState({ notes, list: listOf(notes), rev });
}

/** Off the list: a tombstone for the push, or gone at once when the server never had it — unless a sync is out, whose
 *  first upload of it may yet land (send's done() takes that back down). false when there was nothing to remove. */
function unlink(path: string): boolean {
  const n = db.getNote(path);
  if (!n || n.deleted) return false;
  if (n.rec || running) db.patchNote(path, { deleted: true, conflict_text: null, conflict_rev: null });
  else db.deleteNote(path);
  refresh([path]);
  return true;
}

export const useNotes = create<S>()((set, get) => ({
  ...index(),
  rev: {},
  moved: {},
  sync: { state: serverOf() ? "syncing" : "off" },     // not "synced" before the first sync has run
  write: (at, text) => {
    const path = movedTo(at);                       // a screen still open on a note that moved writes where it went
    const n = db.getNote(path);
    if (n && !n.deleted && n.text === text) return;
    if (n) db.patchNote(path, { ...fieldsOf(path, text), updated: tick(n), deleted: false });
    else db.putNote(fresh(path, text, tick()));
    refresh([path]);
    if (n?.rec != null || parseNote(path, text).body.trim()) pushSoon();
  },
  create: (title, o = {}) => {
    const now = o.now ?? Date.now(), path = newNotePath(title, now, new Set(db.allPaths()));
    const meta = { title: title.trim(), created: localDay(now), pinned: o.pinned, color: o.color ?? undefined, tags: inheritTags(activeLensNow(), o.tags) };
    get().write(path, serializeNote(meta, o.body ?? ""));
    return path;
  },
  remove: (path) => { if (unlink(path)) syncNotes(); },
  discardNew: (path, made) => {
    const n = db.getNote(path);
    if (n && !n.deleted && n.rec == null && n.text === made && !parseNote(path, n.text).body.trim()) unlink(path);
  },
  setFlags: (path, flags) => {
    const n = db.getNote(path);
    if (n && !n.deleted) get().write(path, withFlags(path, n.text, flags));
  },
  keepMine: (path) => {
    const n = db.getNote(path);
    if (n?.conflict_rev == null) return;                           // a second tap
    db.patchNote(path, { rev: n.conflict_rev, base: n.conflict_text, conflict_text: null, conflict_rev: null });
    refresh([path], false);
    syncNotes();
  },
  takeTheirs: (path) => {
    const n = db.getNote(path);
    if (n?.conflict_rev == null || n.conflict_text == null) return;
    const t = tick(n);
    db.patchNote(path, {
      ...fieldsOf(path, n.conflict_text), rev: n.conflict_rev, base: n.conflict_text, updated: t, pushed: t,
      conflict_text: null, conflict_rev: null, lost: n.text,
    });
    refresh([path]);
    if (get().sync.state === "conflict") set({ sync: settled(get().sync.at) });
  },
  restore: (path) => {
    const n = db.getNote(path);
    if (n?.lost == null) return;
    db.patchNote(path, { ...fieldsOf(path, n.lost), updated: tick(n), lost: null });
    refresh([path]);
    syncNotes();
  },
  discard: (path) => {
    if (db.patchNote(path, { lost: null })) refresh([path], false);
  },
}));

/** Rebuild the index from SQLite. */
export const reloadNotes = () => useNotes.setState(index());

/** The notes list (notes/ only: pinned first, then the latest changed) inside the lens that is on, or all of it. The one way a
 *  screen reads the list to show it; opening a note by its id or path never goes through it. */
export function useNoteList(): readonly NoteMeta[] {
  const list = useNotes((s) => s.list), lens = useActiveLens();
  return useMemo(() => withinLens(lens, list), [list, lens]);
}

/** A file's text off the phone, outside React (agent tools); null when it isn't here. `rev`: the file's useNotes
 *  rev, unread — passed by useNoteText so its memo has a real input that changes with the text. */
export function noteText(path: string, rev?: number): string | null {
  const n = db.getNote(path);
  return n && !n.deleted ? n.text : null;
}

/** An open note's text: read from SQLite, re-read when that file changes. null when it isn't on the phone. */
export function useNoteText(path: string): string | null {
  const rev = useNotes((s) => s.rev[path] ?? 0);
  return useMemo(() => noteText(path, rev), [path, rev]);
}

/** A note's server record id, followed as the index changes (it has one once it first went up); null before, or when it
 *  isn't on the phone. */
export const useNoteRec = (path: string): string | null => useNotes((s) => (s.notes[path] ? db.noteRec(path) : null));

/** The note a server record id is, as the phone has it, followed as the index changes; null when it isn't here. */
export const useRecPath = (rec: string): string | null => useNotes((s) => (s.notes ? db.pathOfRec(rec) : null));

/** Where a note is now: its own path, or the one moveAside gave it, while nothing else has taken the old one. */
export function movedTo(path: string): string {
  const to = useNotes.getState().moved[path];
  return to && !db.getNote(path) ? to : path;
}

/** idle, or how many notes wait on a side being picked. */
function settled(at = Date.now()): SyncState {
  const n = Object.values(useNotes.getState().notes).filter((m) => m.conflict).length;
  return n ? { state: "conflict", conflicts: n, at } : { state: "idle", at };
}

type Fail = (what: string, e: unknown) => void;

/** The records this app syncs. */
const want = (path: string) => isNotePath(path) || path === MEMORY;

/** Local midnight of the note's `created`, so a first pull lists notes by age, not all at "now". */
function createdAt(path: string, text: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(parseNote(path, text).created);
  const t = d ? new Date(+d[1], +d[2] - 1, +d[3]).getTime() : NaN;
  return t > 0 && t < Date.now() ? t : Date.now();
}

/** The server's text into the row, unless typed into or deleted while the read was out (push sorts those out).
 *  true when the text changed. */
function take(r: pb.Remote): boolean {
  const { path, text, rec, rev, kind } = r, n = db.getNote(path);
  if (n && (unsent(n) || n.deleted || n.conflict_rev != null)) return false;
  if (n && n.text === text) { db.patchNote(path, { rec, rev, base: text, kind }); return false; }
  if (n) { const t = tick(n); db.patchNote(path, { ...fieldsOf(path, text), rec, rev, base: text, kind, updated: t, pushed: t }); }
  else { const t = createdAt(path, text); db.putNote({ ...fresh(path, text, t), rec, rev, base: text, kind, pushed: t }); }
  return true;
}

/** The photos `path`'s text shows that the phone has no row for: the server's listing is what says where they are. */
function lacksPhotos(path: string): boolean {
  const n = db.getNote(path);
  if (!n || !n.text.includes(ATTACHMENTS)) return false;
  let lacks = false;
  rewriteImagePaths(n.text, n.id, (name) => { if (!db.getAttachment(n.id, name)) lacks = true; return undefined; });
  return lacks;
}

/** `photos`: list the server's photos too, which a pull does anyway when a note it took shows one the phone has no row for.
 *  false when the server couldn't be reached: nothing else is worth trying this round. */
async function pull(s: pb.Server, fail: Fail, photos: boolean): Promise<boolean> {
  let down = false;
  const failed: Fail = (what, e) => { if (unreachable(e)) down = true; fail(what, e); };
  let entries: pb.Listed[];
  try { entries = await pb.list(s); } catch (e) { failed("pull", e); return !down; }
  const remote = new Map(entries.filter((e) => want(e.path)).map((e) => [e.path, e]));
  const local = new Map(db.syncState().map((r) => [r.path, r]));
  const changed: string[] = [], taken: string[] = [], flush = () => { if (changed.length) refresh(changed.splice(0)); };
  try {
    const stale = [...remote.values()].filter((e) => { const l = local.get(e.path); return !l || !(l.rev === e.rev || l.dirty || l.deleted || l.conflict); });
    await pool(stale, 6, async (e) => {
      if (down) return;                                            // each would wait out its own timeout
      try {
        const rem = await pb.get(s, e.rec);
        if (rem && take(rem)) { changed.push(e.path); taken.push(e.path); }
        if (changed.length >= 50) flush();                         // a first pull fills the list as it goes
      } catch (err) { failed(e.path, err); }
    });
    // Gone from the server: removed here too, unless edited here since (push puts it back). A tombstone's delete is done.
    for (const path of local.keys()) {
      if (!want(path) || remote.has(path)) continue;
      const n = db.getNote(path);
      if (!n || !(n.deleted || !unsent(n))) continue;
      db.deleteNote(path); changed.push(path);
    }
  } finally { flush(); }
  listedFrom(remote);
  if (down) return false;
  if (photos || taken.some(lacksPhotos)) try { photosFrom(await pb.photos(s)); } catch (e) { failed("photos", e); }
  return !down;
}

/** The listing's kind onto the rows that have it, notes fetched by this pull included: a kind never moves, but a copy
 *  pulled before the phone kept kinds has the rev and lacks it. */
function listedFrom(remote: Map<string, pb.Listed>) {
  const moved = db.syncState().filter((r) => { const e = remote.get(r.path); return e && r.kind !== e.kind; });
  for (const r of moved) db.patchNote(r.path, { kind: remote.get(r.path)!.kind });
  if (moved.length) refresh(moved.map((r) => r.path), false);
}

/** Attachment rows from the server's listing: its record and stored file recorded, bytes left to
 *  src/store/attachments.ts (`local` null = not fetched; a new record drops the stale copy). Rows gone from the
 *  server go too, except photos added here and not uploaded yet. */
export function photosFrom(photos: pb.Photo[]) {
  const seen = new Set<string>();
  for (const p of photos) {
    seen.add(`${p.note}/${p.name}`);
    const row = db.getAttachment(p.note, p.name);
    if (row?.rec === p.rec || (row && row.rec == null)) continue;
    db.putAttachment({ note_id: p.note, name: p.name, rec: p.rec, file: p.file, size: null, local: null, pushed: Date.now() });
  }
  for (const a of db.allAttachments()) if (a.rec != null && !seen.has(`${a.note_id}/${a.name}`)) db.deleteAttachment(a.note_id, a.name);
}

async function push(s: pb.Server, fail: Fail) {
  for (const path of db.dirtyPaths()) await send(s, path).catch((e) => fail(path, e));
  for (const t of db.tombstones()) await drop(s, t).catch((e) => fail(t.path, e));
}

/** A note made here whose path the server has already — the laptop made one by that name before this phone pulled —
 *  moved to a free path: text, flags and the photos added here go along, the old row goes. `taken`: paths the server
 *  was found to hold. Returns the new path. */
function moveAside(path: string, n: db.NoteRow, taken: Set<string>): string {
  taken.add(path);
  const to = newNotePath(n.title, createdAt(path, n.text), new Set([...db.allPaths(), ...taken]));
  const from = noteIdOf(path), id = noteIdOf(to), names = new Set(moveAttachments(from, id));
  const text = names.size ? rewriteImagePaths(n.text, from, (name) => (names.has(name) ? `../${ATTACHMENTS}${id}/${name}` : undefined)) : n.text;
  db.putNote({ ...n, ...fieldsOf(to, text), path: to, updated: tick(n) });
  db.deleteNote(path);
  useNotes.setState((s) => ({ moved: { ...s.moved, [path]: to } }));     // before the refresh: an open editor's save follows it
  refresh([path, to]);
  return to;
}

/** One file. A stale rev: same text or disjoint edits settle here (merged ones go out once more); overlap is a conflict.
 *  `taken`: paths moveAside found the server holding, so a second move doesn't land on one. */
async function send(s: pb.Server, path: string, retry = true, taken = new Set<string>()): Promise<void> {
  const n = db.getNote(path);
  if (!n || n.deleted || !unsent(n) || n.conflict_rev != null) return;
  const at = n.updated;                                            // edits made mid-request stay unsent
  const done = async (r: pb.Remote) => {
    const now = db.getNote(path);
    // Deleted while it went up: a tombstone gets the record for drop() to delete, next in this push; a row gone
    // altogether is taken down here, or the next pull would bring the note back
    if (!now) return pb.remove(s, r);
    if (now.deleted) return void db.patchNote(path, { rec: r.rec, rev: r.rev });
    db.patchNote(path, { rec: r.rec, rev: r.rev, base: n.text, pushed: at });
    refresh([path], false);
  };
  try {
    // Gone from the server since (deleted on the laptop) while edited here: the edit puts it back
    const r = (n.rec && n.rev != null ? await pb.update(s, { rec: n.rec, path, rev: n.rev }, n.text) : null) ?? await pb.create(s, path, n.text);
    return await done(r);
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
  }
  const rem = await pb.read(s, path);
  if (!rem) return done(await pb.create(s, path, n.text));        // deleted between the refusal and the read
  const cur = db.getNote(path);
  if (!cur || cur.deleted) return;
  // Never pushed, and the server has the path: someone else's note, not this one's past to merge with. The same text
  // is this upload, landed once before the app was killed; anything else, this note moves aside and goes up there
  if (cur.rec == null && isNotePath(path) && rem.text !== cur.text) return send(s, moveAside(path, cur, taken), retry, taken);
  const m = reconcile(cur.base ?? undefined, cur.text, rem.text);
  if (m == null) {
    db.patchNote(path, { rec: rem.rec, conflict_text: rem.text, conflict_rev: rem.rev });
    return refresh([path], false);
  }
  db.patchNote(path, { ...fieldsOf(path, m), rec: rem.rec, rev: rem.rev, base: rem.text, ...(m === rem.text ? { pushed: cur.updated } : {}) });
  refresh([path], m !== cur.text);
  if (m !== rem.text && retry) await send(s, path, false, taken);
}

/** One tombstone. Edited on the server since this phone last saw it: that edit outlives the delete, and the
 *  note comes back with it. */
async function drop(s: pb.Server, t: db.NoteRow): Promise<void> {
  const gone = () => { if (db.getNote(t.path)?.deleted) db.deleteNote(t.path); };   // unless written to again meanwhile
  if (!t.rec || t.rev == null) return gone();
  try {
    await pb.remove(s, { rec: t.rec, rev: t.rev });
    return gone();
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
  }
  const rem = await pb.get(s, t.rec);
  if (!rem) return gone();
  if (!db.getNote(t.path)?.deleted) return;
  const u = tick(t);
  db.patchNote(t.path, { ...fieldsOf(t.path, rem.text), rev: rem.rev, base: rem.text, updated: u, pushed: u, deleted: false });
  refresh([t.path]);
}

let running: Promise<void> | null = null, again = false, againPhotos = false, lastSync = 0;

/** `photos`: list the server's photos too (foreground, launch, a photo event; a pull that takes a note showing one
 *  the phone has no row for does it on its own). */
export type SyncOpts = { photos?: boolean };

/** After the last write, how long before it goes up. Without it an edit stays "unsent" for as long as its note is open
 *  (the note screen reads that off the row), and one made while a push was out is never sent at all until something
 *  else syncs. A note just made and still empty waits: leaving it as it was drops it (discardNew), which a push
 *  would have made impossible. */
const PUSH_AFTER = 1500;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const pushSoon = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => void syncNotes(), PUSH_AFTER); };

/** Pull then push, each file on its own: one failure holds back nothing else. Safe to call from anywhere,
 *  any time: overlapping calls coalesce into one rerun. A server that can't be reached ends the round after the pull. */
export function syncNotes(o: SyncOpts = {}): Promise<void> {
  clearTimeout(pushTimer);                                        // this sync pushes what the timer was waiting to
  if (running) { again = true; againPhotos ||= !!o.photos; return running; }
  const server = serverOf();
  if (!server) { useNotes.setState({ sync: { state: "off" } }); return Promise.resolve(); }
  running = (async () => {
    useNotes.setState({ sync: { ...useNotes.getState().sync, state: "syncing" } });
    const errs: string[] = [], fail: Fail = (what, e) => { errs.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); };
    try {
      if (await pull(server, fail, !!o.photos)) {
        await push(server, fail);
        await syncAttachments().catch(() => {});                  // photos keep their own errors (useAttachmentSync); none fails a note sync
        lastSync = Date.now();
      }
    } catch (e) {
      fail("sync", e);
    } finally {
      useNotes.setState({ sync: errs.length ? failed(errs) : settled() });
      running = null;
      if (again) { const photos = againPhotos; again = againPhotos = false; syncNotes({ photos }); }
    }
  })();
  return running;
}

/** The server's own news, or this phone's push echoing back? A note whose rev the phone already has
 *  is the echo, a photo it has the record of too. */
function isNews(e: LiveEvent): boolean {
  const r = e.record;
  if (!r) return true;
  if (e.topic === "attachments") {
    const a = db.getAttachment(r.note, r.name);
    return e.action === "delete" ? a?.rec != null : a?.rec !== r.id;
  }
  if (typeof r.path !== "string" || !want(r.path)) return false;
  const n = db.getNote(r.path);
  if (e.action === "delete") return !!n && !n.deleted;
  return !n || n.rev !== r.rev;
}

/** A sync that ended this recently already knows what a fresh connection would tell it. */
const RECENT = 5000;

/** The feed's events (live.ts) → at most one sync, with the photo listing only when a photo event asks for it. */
export function heard(events: LiveEvent[]) {
  const news = events.filter((e) => (e.topic === "notes" || e.topic === "attachments") && isNews(e));
  const connect = events.some((e) => e.topic === "connect") && !running && Date.now() - lastSync > RECENT;
  if (news.length || connect) syncNotes({ photos: connect || news.some((e) => e.topic === "attachments") });
}

/** Settings' Server: where notes sync to, then a sync; empty keeps them on this phone. An error to show, or null. */
export function setServer(url: string): string | null {
  const u = pb.serverUrl(url);
  if (url.trim() && !/^https?:\/\/[^/]+$/.test(u)) return `Not a server address: ${url.trim()}`;
  useKeys.getState().set("server", u);
  syncNotes({ photos: true });
  return null;
}

// When notes talk to the server: on launch, on coming to the front (pull the laptop's edits), on going to the
// background (push the phone's), and while in front, whenever the server says a record changed (useLive, in the root layout).
// A write pushes 1.5 s later (pushSoon); leaving a note pushes at once — see src/ui/note.tsx.
export function useNoteSync() {
  useEffect(() => {
    syncNotes({ photos: true });
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") syncNotes({ photos: true }); else if (s === "background") syncNotes(); });
    return () => sub.remove();
  }, []);
}
