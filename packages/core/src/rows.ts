// The sync engine's rows (sync.ts `NoteRow`, `TaskRow`, `LinkRow`) read back from storage that outlives the build that wrote
// them (the web's IndexedDB copy, web/src/lib/local.ts): one tab may run an older build than another, and a row's shape changes
// with the engine. `ROWS_VERSION` is the shape this build writes, stored beside the rows; a store of a newer one is not this
// build's to read. Each reader takes a stored value and returns the row it is, a field a row may lack set to its empty value,
// or undefined for a value that isn't one (it is dropped, never loaded as if it were).
// A change to a row's shape is a new `ROWS_VERSION` and a step in the client's migration (web/src/lib/local.ts `read`).
import { noteKindOf } from "./notes";
import { LINK_TYPES, linkColumn, linkOf } from "./record-links";
import type { LinkRow, NoteRow, TaskRow } from "./sync";
import { taskOf } from "./todo";

/** The shape of the rows this build writes. */
export const ROWS_VERSION = 1;

type Fields = Record<string, unknown>;
const record = (v: unknown): v is Fields => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A number or null; anything else (a field the row lacks) null. */
const countOrNull = (v: unknown): number | null => (count(v) ? v : null);
const textOrNull = (v: unknown): string | null => (text(v) ? v : null);
/** The fields every row may carry: why the server refused its change. */
const refusedOf = (r: Fields) => (text(r.refused) ? { refused: r.refused } : {});

/** A stored note row; undefined without its path, text, record id or `updated`. */
export function noteRowOf(v: unknown): NoteRow | undefined {
  if (!record(v) || !text(v.path) || !text(v.text) || !text(v.rec) || !v.rec || !count(v.updated)) return undefined;
  return {
    path: v.path, text: v.text, kind: noteKindOf(v.kind), updated: v.updated, pushed: countOrNull(v.pushed),
    rec: v.rec, rev: countOrNull(v.rev), base: textOrNull(v.base),
    conflict_text: textOrNull(v.conflict_text), conflict_rev: countOrNull(v.conflict_rev), lost: textOrNull(v.lost),
    deleted: v.deleted === true, ...refusedOf(v), ...(v.tainted === true ? { tainted: true as const } : {}),
  };
}

/** A stored task row; undefined without its id, its task (of the same id) or `updated`. */
export function taskRowOf(v: unknown): TaskRow | undefined {
  if (!record(v) || !text(v.id) || !v.id || !record(v.data) || v.data.id !== v.id || !count(v.updated)) return undefined;
  return {
    id: v.id, data: taskOf(v.data), base: record(v.base) ? taskOf(v.base) : null, rev: countOrNull(v.rev),
    updated: v.updated, pushed: countOrNull(v.pushed), deleted: v.deleted === true, ...refusedOf(v),
  };
}

/** A stored link row; undefined when its link isn't one (core/record-links.ts `linkOf`). */
export function linkRowOf(v: unknown): LinkRow | undefined {
  const link = record(v) ? linkOf(linkColumnsOf(v.link)) : null;
  if (!record(v) || !link || !link.id) return undefined;
  return { link, pushed: countOrNull(v.pushed), deleted: v.deleted === true, ...refusedOf(v) };
}

/** A stored `Link` (`{ id, from, to, role }`) as the record columns `linkOf` reads. */
function linkColumnsOf(v: unknown): Fields {
  if (!record(v) || !record(v.from) || !record(v.to)) return {};
  const end = (side: "from" | "to", e: Fields) => {
    const type = LINK_TYPES.find((t) => t === e.type);
    return type && text(e.id) ? { [linkColumn(side, type)]: e.id } : {};
  };
  return { id: v.id, role: v.role, ...end("from", v.from), ...end("to", v.to) };
}
