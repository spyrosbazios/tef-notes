// Notes on the server. Every write is compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): it names the version
// it was based on, and a stale one is a Conflict, never a silent overwrite. The columns beside `text` are copied out
// of it by the core's noteColumns, the same ones the phone and the CLI send. `kind` (core/notes.ts
// NoteKind) is the server's own: read, never sent; set when a note is made, never changed.
import { MEMORY, noteKindOf, parseNote, type Note, type NoteKind } from "@/core/notes";
import { noteColumns, type Entry } from "@/core/pocketbase";
import { api, lit, orNull } from "./api";

/** `kind`: what the note is. */
export type Rec = Entry & { kind: NoteKind; text: string; updated: string };
/** A record with its text parsed: the text is the truth, the server's title/flag columns are only copies. */
export type NoteRec = Rec & { note: Note };

const PAGE = 500;
const FIELDS = "id,path,rev,kind,text,updated";

const rec = (r: any): Rec => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind), text: r.text ?? "", updated: r.updated });
export const withNote = (r: Rec): NoteRec => ({ ...r, note: parseNote(r.path, r.text) });

/** Every note, text and all: a personal notebook is small enough that the laptop holds it whole and searches it
 *  folded (Greek tonos too), as the phone does, instead of the server's LIKE. */
export async function all(): Promise<NoteRec[]> {
  const out: NoteRec[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get("collections/notes/records", {
      params: { fields: FIELDS, filter: 'path ~ "notes/%"', sort: "-updated", perPage: PAGE, page, skipTotal: 1 },
    });
    out.push(...data.items.map((r: any) => withNote(rec(r))));
    if (data.items.length < PAGE) return out;
  }
}

/** One record as it is now; null when it's gone. */
export const get = (id: string) => orNull(api.get(`collections/notes/records/${id}`, { params: { fields: FIELDS } }).then((r) => rec(r.data)));

/** The in-app agent's memory file; null before the agent first wrote it. */
export async function memory(): Promise<Rec | null> {
  const { data } = await api.get("collections/notes/records", { params: { fields: FIELDS, filter: `path = ${lit(MEMORY)}`, perPage: 1, skipTotal: 1 } });
  return data.items.length ? rec(data.items[0]) : null;
}

/** A new record at rev 1. Conflict: the path is taken. */
export const create = async (path: string, text: string): Promise<Rec> =>
  rec((await api.post("collections/notes/records", noteColumns(path, text), { params: { fields: FIELDS } })).data);

/** The whole file replaced, if still at `e.rev`. Conflict: it moved on since. null: it's gone. */
export const update = (e: Entry, text: string): Promise<Rec | null> =>
  orNull(api.patch(`collections/notes/records/${e.rec}`, { ...noteColumns(e.path, text), rev: e.rev }, { params: { fields: FIELDS } }).then((r) => rec(r.data)));

/** Gone, photos and all, unless it moved on since `rev` (Conflict). Already gone is done. */
export async function remove(e: Pick<Entry, "rec" | "rev">): Promise<void> {
  await orNull(api.delete(`collections/notes/records/${e.rec}`, { params: { rev: e.rev } }));
}
