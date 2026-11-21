// Notes on the server, as the sync engine (lib/sync.ts) calls them, every request marked `synced` (services/api.ts). Every write is
// compare-and-swap on `rev` (server/pb_hooks/rev.pb.js): it names the version it was based on, and a stale one is a Conflict,
// never a silent overwrite. The columns beside `text` are copied out
// of it by the core's noteColumns, the same ones the phone and the CLI send. `kind` (core/notes.ts
// NoteKind) is the server's own: read, never sent; set when a note is made, never changed.
import { MEMORY, noteKindOf, parseNote, type Note, type NoteKind } from "@/core/notes";
import type { Entry, Mark } from "@/core/record-contracts";
import { noteCollection } from "@/core/record-protocol";
import { recordTransport } from "./records";

/** `kind`: what the note is. */
export type Rec = Entry & { kind: NoteKind; text: string; updated: string };
/** A record with its text parsed: the text is the truth, the server's title/flag columns are only copies. */
export type NoteRec = Rec & { note: Note };

const rec = (r: any): Rec => ({ rec: r.id, path: r.path, rev: r.rev, kind: noteKindOf(r.kind), text: r.text ?? "", updated: r.updated });
export const withNote = (r: Rec): NoteRec => ({ ...r, note: parseNote(r.path, r.text) });

const notes = noteCollection(recordTransport, rec, {
  fields: "id,path,rev,kind,text,updated", filter: 'path ~ "notes/%"',
});
export const { list, get, read, remove } = notes;
/** `mark`: the text holds someone else's (`tainted`, server/pb_hooks/tainted.pb.js keeps it from then on). */
export const create = (rec: string, path: string, text: string, mark: Mark = {}): Promise<Rec> => notes.create(rec, path, text, mark);
export const update = (e: Entry, text: string, mark: Mark = {}): Promise<Rec | null> => notes.update(e, text, mark);

/** The in-app agent's memory file; null before the agent first wrote it. */
export const memory = () => read(MEMORY);
