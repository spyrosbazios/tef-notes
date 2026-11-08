// Notes on the server, as the sync engine (lib/sync.ts) calls them, every request marked `synced` (services/api.ts). Every write is
// compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): it names the version it was based on, and a stale one is a Conflict,
// never a silent overwrite. The columns beside `text` are copied out
// of it by the core's noteColumns, the same ones the phone and the CLI send. `kind` (core/notes.ts
// NoteKind) is the server's own: read, never sent; set when a note is made, never changed.
import { MEMORY, noteKindOf, parseNote, type Note, type NoteKind } from "@/core/notes";
import { noteColumns, type Entry, type Listed } from "@/core/pocketbase";
import { api, lit, orNull, synced } from "./api";

/** `kind`: what the note is. */
export type Rec = Entry & { kind: NoteKind; text: string; updated: string };
/** A record with its text parsed: the text is the truth, the server's title/flag columns are only copies. */
export type NoteRec = Rec & { note: Note };

const PAGE = 500;
const FIELDS = "id,path,rev,kind,text,updated";

const rec = (r: any): Rec => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind), text: r.text ?? "", updated: r.updated });
export const withNote = (r: Rec): NoteRec => ({ ...r, note: parseNote(r.path, r.text) });

/** Every note's path, rev and kind, no text: what a pull compares the local copy against. */
export async function list(): Promise<Listed[]> {
  const out: Listed[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get("collections/notes/records", {
      params: { fields: "id,path,rev,kind", filter: 'path ~ "notes/%"', perPage: PAGE, page, skipTotal: 1 }, ...synced,
    });
    out.push(...data.items.map((r: any) => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind) })));
    if (data.items.length < PAGE) return out;
  }
}

/** One record as it is now; null when it's gone. */
export const get = (id: string) => orNull(api.get(`collections/notes/records/${id}`, { params: { fields: FIELDS }, ...synced }).then((r) => rec(r.data)));

/** One record by path; null when there is none. */
export async function read(path: string, timeout?: number): Promise<Rec | null> {
  const { data } = await api.get("collections/notes/records", { params: { fields: FIELDS, filter: `path = ${lit(path)}`, perPage: 1, skipTotal: 1 }, timeout, ...synced });
  return data.items.length ? rec(data.items[0]) : null;
}

/** The in-app agent's memory file; null before the agent first wrote it. */
export const memory = () => read(MEMORY);

/** A new record at rev 1. Conflict: the path is taken. */
export const create = async (path: string, text: string): Promise<Rec> =>
  rec((await api.post("collections/notes/records", noteColumns(path, text), { params: { fields: FIELDS }, ...synced })).data);

/** The whole file replaced, if still at `e.rev`. Conflict: it moved on since. null: it's gone. */
export const update = (e: Entry, text: string): Promise<Rec | null> =>
  orNull(api.patch(`collections/notes/records/${e.rec}`, { ...noteColumns(e.path, text), rev: e.rev }, { params: { fields: FIELDS }, ...synced }).then((r) => rec(r.data)));

/** Gone, photos and all, unless it moved on since `rev` (Conflict). Already gone is done. */
export async function remove(e: Pick<Entry, "rec" | "rev">): Promise<void> {
  await orNull(api.delete(`collections/notes/records/${e.rec}`, { params: { rev: e.rev }, ...synced }));
}
