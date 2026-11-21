// Shared record and error contracts. No transport or platform dependencies.
import { parseNote, type NoteKind } from "./notes";
export type Entry = { rec: string; path: string; rev: number };
export type Remote = Entry & { text: string; kind: NoteKind };
export type Listed = Entry & { kind: NoteKind };
export type Versioned<T> = T & { rev: number };
export type RevEntry = { id: string; rev: number };
export type Mark = { tainted?: true };
export class Conflict extends Error {}

/** Map only conflicts; callers retain their native HTTP error for every other failure. */
export function conflictOf(status: number | undefined, body: any, what: string): Conflict | undefined {
  const taken = (f: string) => body?.data?.[f]?.code === "validation_not_unique";
  if (status === 409 || (status === 400 && ["path", "note", "name", "id"].some(taken))) return new Conflict(what);
}

/** A PocketBase filter literal, including backslash and quote escaping. */
export const lit = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A filter literal for `~` that matches `v` as plain text, wherever it sits. PocketBase wraps a `~` value in `%` and escapes
 *  its `%`, `_` and `\` only when the value holds no unescaped `%`; with one it is a raw LIKE pattern, so a typed `100%` finds
 *  "100" followed by anything, not a percent sign. Escaping them here keeps every case literal: a character already
 *  escaped is left alone (github.com/pocketbase/pocketbase tools/search/filter.go `wrapLikeParams`). */
export const likeLit = (v: string) => lit(v.replace(/[\\%_]/g, "\\$&"));

/** Only client-owned columns: a PATCH preserves the server's tagging state and immutable kind. */
export function noteColumns(path: string, text: string) {
  const n = parseNote(path, text);
  return { path, text, title: n.title, day: /^\d{4}-\d{2}-\d{2}$/.test(n.created) ? n.created : "", pinned: n.pinned,
    archived: n.archived, color: n.color ?? "", tags: n.tags };
}

