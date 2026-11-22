// Tag definitions and the tag routes on the server through the shared protocol (core/record-protocol.ts `tags`): name, badge
// colour and the hint the AI reads. A note's own tags live in its text; deleting a definition leaves notes alone, renaming one
// renames it on them too. Conflict: the name is taken, ignoring case.
import { recordId } from "@/core/client/ids";
import { tags } from "@/core/record-protocol";
import type { TagFields } from "@/core/tags";
import { directTransport } from "./records";

export const list = () => tags.list(directTransport);
export const create = (t: TagFields) => tags.create(directTransport, t, recordId());
export const update = (rec: string, t: TagFields) => tags.update(directTransport, rec, t);
/** Already gone is done. */
export const remove = (rec: string) => tags.remove(directTransport, rec);
export const rename = (from: string, to: string) => tags.rename(directTransport, from, to);
/** A description written from the notes that carry the tag `name`: not saved, the editor shows it. */
export const describe = (name: string) => tags.describe(directTransport, name);
/** The tags JEV gives a task being typed (@/core/tags tagGuesser). */
export const guess = (draft: { title: string; notes: string }, signal: AbortSignal) => tags.guess(directTransport, draft, signal);
