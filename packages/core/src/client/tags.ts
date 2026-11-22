// Tag calls to the server over fetch (the shapes and the rules: core/tags.ts): the definitions, the rename, the descriptions
// written from the notes, and the guess for a task being typed.
import { tagColumns, tagDef, type Described, type Renamed, type TagDef, type TagFields, type TagMark } from "../tags";
import type { Server } from "../urls";
import { getJson, HttpError } from "./http";
import { call, createdUnder, json, recordId } from "./pocketbase";

/** Every definition, by name. */
export async function listTags(s: Server): Promise<TagDef[]> {
  const j = await call(s, "collections/tags/records?perPage=500&skipTotal=1&sort=name");
  return j.items.map(tagDef);
}

/** A new definition, under an id of its own (`id`, made here when not given): sent again when no answer came, never twice.
 *  Conflict: a tag by that name (ignoring case) exists. */
export const createTag = (s: Server, t: TagFields, mark?: TagMark, id = recordId()): Promise<TagDef> => createdUnder(
  async () => tagDef(await call(s, "collections/tags/records", json("POST", { id, ...tagColumns(t, mark) }))),
  async () => { try { return tagDef(await call(s, `collections/tags/records/${id}`)); } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; } });

/** Conflict: the new name is taken. */
export const updateTag = async (s: Server, rec: string, t: TagFields, mark?: TagMark): Promise<TagDef> =>
  tagDef(await call(s, `collections/tags/records/${rec}`, json("PATCH", tagColumns(t, mark))));

/** Renames the tag `from` to `to` on every note, task, lens and its definition, in one transaction on the server; a
 *  `to` already defined (case and tonos ignored) merges the two. */
export const renameTag = (s: Server, from: string, to: string): Promise<Renamed> =>
  getJson(`${s.url}/api/tefnotes/tags/rename`, json("POST", { from, to }), 1);

// A model call is behind a description and a guess, so they wait longer than a read and are not retried.
const DESCRIBE_ALL_MS = 600_000, GUESS_MS = 20_000;

/** A description for every tag that has a note, by name. A tag the model failed on is left out. Its failure's message is
 *  the server's words (no note carries the tag, no key, the model failed: record-contracts.ts `serverError`). */
export const describeAllTags = (s: Server): Promise<Described[]> =>
  getJson(`${s.url}/api/tefnotes/tags/describe`, json("POST", { all: true }), 1, DESCRIBE_ALL_MS);

/** The tags JEV gives a task with this title and notes, likeliest first. */
export async function guessTags(s: Server, draft: { title: string; notes: string }, signal: AbortSignal): Promise<string[]> {
  const j = await getJson(`${s.url}/api/tefnotes/tags/guess`, { ...json("POST", draft), signal }, 1, GUESS_MS);
  return Array.isArray(j?.tags) ? j.tags.filter((t: unknown): t is string => typeof t === "string") : [];
}
