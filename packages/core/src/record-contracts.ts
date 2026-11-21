// Shared record and error contracts. No transport or platform dependencies.
import { parseNote, type NoteKind } from "./notes";
export type Entry = { rec: string; path: string; rev: number };
export type Remote = Entry & { text: string; kind: NoteKind };
export type Listed = Entry & { kind: NoteKind };
export type Versioned<T> = T & { rev: number };
export type RevEntry = { id: string; rev: number };
export type Mark = { tainted?: true };
/** A stale rev, or a create whose unique name (path, record id, photo name) the server holds already. Re-read and settle. */
export class Conflict extends Error {}
/** The record is not there, or one a write names is not (a link to a note deleted meanwhile). Nothing to retry. */
export class Gone extends Error {}
/** The server answered and will refuse the same request again: it has to change before it is sent once more. */
export class Refused extends Error {}
/** No answer to act on: nothing answered (the network, a timeout), or the server is failing for now. Worth trying later. */
export class Unavailable extends Error {}

/** Map only conflicts; callers retain their native HTTP error for every other failure. */
export function conflictOf(status: number | undefined, body: any, what: string): Conflict | undefined {
  const taken = (f: string) => body?.data?.[f]?.code === "validation_not_unique";
  if (status === 409 || (status === 400 && ["path", "note", "name", "id"].some(taken))) return new Conflict(what);
}

/** A PocketBase filter literal, including backslash and quote escaping. */
export const lit = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Only client-owned columns: a PATCH preserves the server's tagging state and immutable kind. */
export function noteColumns(path: string, text: string) {
  const n = parseNote(path, text);
  return { path, text, title: n.title, day: /^\d{4}-\d{2}-\d{2}$/.test(n.created) ? n.created : "", pinned: n.pinned,
    archived: n.archived, color: n.color ?? "", tags: n.tags };
}

