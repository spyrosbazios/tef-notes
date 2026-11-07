// What the note sync (notes.ts) and the task sync (todo.ts) share: the state they show, the clock that marks an edit
// unsent, a small worker pool, and telling a server that answered badly from one nothing answered for.
import { HttpError } from "@/core/http";

export type SyncState = { state: "off" | "idle" | "syncing" | "error" | "conflict"; err?: string; at?: number; conflicts?: number };

/** The next `updated` of a row: it only moves forward, so an edit in the same millisecond as a pull, push or pick still
 *  reads as unsent. */
export const tick = (n?: { updated: number } | null) => Math.max(Date.now(), (n?.updated ?? 0) + 1);

/** `n` at a time, in order. */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Not the server answering badly but nothing answering: a timeout, a refused or dropped connection. */
export const unreachable = (e: unknown) => !(e instanceof HttpError);

/** A round's failures as the sync state shows them: the first, and how many more. */
export const failed = (errs: string[]): SyncState =>
  ({ state: "error", err: errs[0].slice(0, 80) + (errs.length > 1 ? ` (+${errs.length - 1} more)` : "") });
