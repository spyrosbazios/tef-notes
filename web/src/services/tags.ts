// Tag definitions on the server: name, badge colour and the hint the AI reads. A note's own tags live in its text
// (services/notes.ts); renaming or deleting a definition leaves notes alone. Conflict: the name is taken, ignoring case.
import { tagColumns, tagDef, type TagDef, type TagFields } from "@/core/tags";
import { api, orNull } from "./api";

export const list = async (): Promise<TagDef[]> =>
  (await api.get("collections/tags/records", { params: { perPage: 500, skipTotal: 1, sort: "name" } })).data.items.map(tagDef);

export const create = async (t: TagFields): Promise<TagDef> => tagDef((await api.post("collections/tags/records", tagColumns(t))).data);

export const update = async (rec: string, t: TagFields): Promise<TagDef> =>
  tagDef((await api.patch(`collections/tags/records/${rec}`, tagColumns(t))).data);

/** Already gone is done. */
export async function remove(rec: string): Promise<void> {
  await orNull(api.delete(`collections/tags/records/${rec}`));
}

/** A description written from the notes that carry the tag `name` (server/pb_hooks/tags.pb.js): not saved, the editor shows it. A model call is behind it, so it waits past the client's usual 45 s. */
export async function describe(name: string): Promise<string> {
  return (await api.post("tefnotes/tags/describe", { tag: name }, { timeout: 90_000 })).data.description;
}

/** The tags JEV gives a task being typed (the server's guess route, @/core/tags tagGuesser). */
export async function guess(draft: { title: string; notes: string }, signal: AbortSignal): Promise<string[]> {
  const tags = (await api.post("tefnotes/tags/guess", draft, { signal, timeout: 20_000 })).data?.tags;
  return Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === "string") : [];
}
