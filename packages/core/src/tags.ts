// Tags. A tag *definition* (name, badge colour, a hint for the AI) is a record in `tags` on the server; a note's own
// tags are its frontmatter `tags:` line, copied into the `tags` column by noteColumns like every flag. Renaming or
// deleting a definition leaves notes alone. The server tags notes itself (its `autotagged` column);
// a client's own tag edits go through applyTags.
// Platform-neutral, like pocketbase.ts: fetch only, so the phone, the web app and the CLI share it.
import { getJson, HttpError } from "./http";
import { fold, parseNote, withFlags, type Color } from "./notes";
import { call, json, type Server } from "./pocketbase";
import type { Task } from "./todo";

export type TagDef = { rec: string; name: string; color?: Color; description: string };
/** What a form edits: everything but the record id. */
export type TagFields = Omit<TagDef, "rec">;

// ---- definitions

/** A `tags` record as a TagDef; the web app's transport maps its own responses through this. */
export const tagDef = (r: any): TagDef => ({ rec: r.id, name: r.name, color: r.color || undefined, description: r.description ?? "" });

/** A TagDef's columns, as the server stores them: no colour is the empty select. */
export const tagColumns = (t: TagFields) => ({ name: t.name.trim(), color: t.color ?? "", description: t.description.trim() });

/** Every definition, by name. */
export async function listTags(s: Server): Promise<TagDef[]> {
  const j = await call(s, "collections/tags/records?perPage=500&skipTotal=1&sort=name");
  return j.items.map(tagDef);
}

/** A new definition. Conflict: a tag by that name (ignoring case) exists. */
export const createTag = async (s: Server, t: TagFields): Promise<TagDef> =>
  tagDef(await call(s, "collections/tags/records", json("POST", tagColumns(t))));

/** Conflict: the new name is taken. */
export const updateTag = async (s: Server, rec: string, t: TagFields): Promise<TagDef> =>
  tagDef(await call(s, `collections/tags/records/${rec}`, json("PATCH", tagColumns(t))));

/** Gone. Already gone is done. */
export async function removeTag(s: Server, rec: string): Promise<void> {
  try { await call(s, `collections/tags/records/${rec}`, { method: "DELETE" }); } catch (e) {
    if (e instanceof HttpError && e.status === 404) return;
    throw e;
  }
}

// ---- descriptions written from the notes

// The server writes a tag's description from the notes that carry it (server/pb_hooks/tags.pb.js, its model) and saves
// nothing: the editor shows it, and it is saved with the tag as any edit is. A model call is behind each, so they wait
// longer than a read and are not retried.
const DESCRIBE_MS = 90_000, DESCRIBE_ALL_MS = 600_000;
export type Described = { tag: string; description: string };

/** The server's words for a failed describe (`{error}`: no note carries the tag, no key, the model failed), else HTTP's. */
export const describeError = (e: unknown): string =>
  e instanceof HttpError && typeof e.body?.error === "string" ? e.body.error : e instanceof Error ? e.message : String(e);

/** A description of the tag `name`, written from the notes that carry it now: at most 400 characters. */
export async function describeTag(s: Server, name: string): Promise<string> {
  const j: Described = await getJson(`${s.url}/api/tefnotes/tags/describe`, json("POST", { tag: name }), 1, DESCRIBE_MS);
  return j.description;
}

/** A description for every tag that has a note, by name. A tag the model failed on is left out. */
export const describeAllTags = (s: Server): Promise<Described[]> =>
  getJson(`${s.url}/api/tefnotes/tags/describe`, json("POST", { all: true }), 1, DESCRIBE_ALL_MS);

// ---- a task being typed

// The server's JEV guesses a draft task's tags (server/pb_hooks/autotag.pb.js, POST /api/tefnotes/tags/guess) and saves
// nothing: the new-task forms ask GUESS_DELAY after the typing stops and show the answer on the draft. Once the task is
// saved its tags are what the form held; the server never tags a task by itself.
export const GUESS_DELAY = 800;
const GUESS_MIN = 3, GUESS_MS = 20_000;

/** The tags JEV gives a task with this title and notes, likeliest first. */
export async function guessTags(s: Server, draft: { title: string; notes: string }, signal: AbortSignal): Promise<string[]> {
  const j = await getJson(`${s.url}/api/tefnotes/tags/guess`, { ...json("POST", draft), signal }, 1, GUESS_MS);
  return Array.isArray(j?.tags) ? j.tags.filter((t: unknown): t is string => typeof t === "string") : [];
}

/** The draft's tags once a new guess is in: the ones put on by hand (`tags` less the previous guess, `before`), then
 *  the new guess less what was taken off by hand (`dismissed`), each once (case and tonos folded). */
export function liveTags(tags: string[], before: string[], guessed: string[], dismissed: string[]): string[] {
  const hand = tags.filter((t) => !before.some((b) => same(b, t)));
  return [...hand, ...guessed.filter((g) => !hand.some((h) => same(h, g)) && !dismissed.some((d) => same(d, g)))];
}

export type Guess = (draft: { title: string; notes: string }, signal: AbortSignal) => Promise<string[]>;

/** A debounced guesser for one form, over `guess` (the phone's is guessTags, the web app's its own transport):
 *  `update(title, notes)` on every keystroke asks GUESS_DELAY after the last one, skips a draft already asked about or
 *  too short (under 3 characters of title), and cancels a request still running, so an older answer never lands after a
 *  newer one. Each answer reaches the form as `apply(tags => next)` (liveTags: hand-added tags kept, the previous guess
 *  replaced); `dismiss(name)` when one is taken off by hand, so no later guess brings it back. A failure is dropped (the
 *  tags stay). `stop()` when the form closes: nothing lands after it. */
export function tagGuesser(guess: Guess, apply: (next: (tags: string[]) => string[]) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, ctl: AbortController | undefined, asked = "", before: string[] = [];
  const dismissed: string[] = [];
  const stop = () => { clearTimeout(timer); ctl?.abort(); };
  const dismiss = (name: string) => { if (!dismissed.some((d) => same(d, name))) dismissed.push(name); };
  const update = (title: string, notes: string) => {
    const draft = { title: title.trim(), notes: notes.trim() }, key = `${draft.title}\u0000${draft.notes}`;
    clearTimeout(timer);
    if (draft.title.length < GUESS_MIN || key === asked) return;
    timer = setTimeout(() => {
      ctl?.abort();
      const mine = (ctl = new AbortController());
      asked = key;
      guess(draft, mine.signal).then((guessed) => {
        if (mine.signal.aborted) return;
        const prev = before;
        before = guessed;
        apply((tags) => liveTags(tags, prev, guessed, dismissed));
      }, () => { if (asked === key) asked = ""; });
    }, GUESS_DELAY);
  };
  return { update, dismiss, stop };
}

// ---- on a note

const same = (a: string, b: string) => fold(a) === fold(b);

/** `text` with `names` added to its tags (ignoring case, already-there ones skipped, order kept) and `remove` taken
 *  off. Returns `text` itself when nothing changes. The caller writes it through the normal rev path. */
export function applyTags(path: string, text: string, add: string[], remove: string[] = []): string {
  const have = parseNote(path, text).tags;
  const next = have.filter((t) => !remove.some((r) => same(r, t)));
  for (const n of add.map((a) => a.trim()).filter(Boolean)) if (!next.some((t) => same(t, n))) next.push(n);
  return next.length === have.length && next.every((t, i) => t === have[i]) ? text : withFlags(path, text, { tags: next });
}

/** A search box's text split into `#tag` words and the rest: `#home keys` → tags ["home"], text "keys". A lone `#`
 *  (a tag about to be typed) is neither. */
export function parseTagQuery(q: string): { tags: string[]; text: string } {
  const tags: string[] = [], rest: string[] = [];
  for (const w of q.trim().split(/\s+/).filter(Boolean)) {
    if (w === "#") continue;
    if (w.startsWith("#")) tags.push(w.slice(1)); else rest.push(w);
  }
  return { tags, text: rest.join(" ") };
}

/** The `#word` a search box ends in, without the `#` ("" for a bare one): the tag still being typed, for autocomplete.
 *  null when the text doesn't end in one (a space after it finishes it). */
export const typingTag = (q: string): string | null => /(?:^|\s)#(\S*)$/.exec(q)?.[1] ?? null;

/** `q` without the tag being typed. */
export const dropTyping = (q: string): string => q.replace(/(^|\s)#\S*$/, "$1");

/** A search box's finished `#tag` words (one followed by a space) taken out of its text, to become chips:
 *  `#home keys #ke` → done ["home"], text "keys #ke". */
export function absorbTags(q: string): { done: string[]; text: string } {
  const done: string[] = [];
  const text = q.replace(/(^|\s)#(\S+)(?=\s)/g, (_, pre: string, name: string) => { done.push(name); return pre; });
  return { done, text: done.length ? text.replace(/^\s+/, "").replace(/\s{2,}/g, " ") : text };
}

/** Every tag name one could pick: the definitions, then the others notes carry (`used`: each note's tags). One entry per
 *  name ignoring case and tonos, spelt as first seen; others in use are sorted. */
export function allTagNames(defs: TagDef[], used: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const d of defs) if (!seen.has(fold(d.name))) seen.set(fold(d.name), d.name);
  const extra = new Map<string, string>();
  for (const t of used.flat()) { const k = fold(t); if (!seen.has(k) && !extra.has(k)) extra.set(k, t); }
  return [...seen.values(), ...[...extra.values()].sort((a, b) => a.localeCompare(b))];
}

/** Tags notes and tasks carry (`used`: each item's tags) that have no definition, with how many items carry each: listed
 *  among Settings' tags, editable like the rest. One entry per name ignoring case and tonos, spelt as first seen, sorted by name. */
export function undefinedTags(defs: TagDef[], used: string[][]): { name: string; count: number }[] {
  const known = new Set(defs.map((d) => fold(d.name)));
  const out = new Map<string, { name: string; count: number }>();
  for (const tags of used) for (const k of new Set(tags.map(fold))) {
    if (known.has(k)) continue;
    const e = out.get(k);
    if (e) e.count++; else out.set(k, { name: tags.find((t) => fold(t) === k) ?? k, count: 1 });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `names` matching what is typed (a `#` optional): prefix matches first, then names that contain it; those in
 *  `have` left out. Empty typing offers the first `limit`. */
export function suggestTags(names: string[], typed: string, have: string[] = [], limit = 8): string[] {
  const w = fold(typed.trim().replace(/^#/, ""));
  const open = names.filter((n) => !have.some((h) => same(h, n)));
  if (!w) return open.slice(0, limit);
  return [...open.filter((n) => fold(n).startsWith(w)), ...open.filter((n) => !fold(n).startsWith(w) && fold(n).includes(w))].slice(0, limit);
}

/** Whether a note's tags satisfy every wanted one, folded (case, Greek tonos). `exact` for a chosen filter; without
 *  it a wanted word is a prefix, for a `#ho` still being typed. */
export const matchesTags = (noteTags: string[], wanted: string[], exact = false) =>
  wanted.every((w) => noteTags.some((t) => (exact ? fold(t) === fold(w) : fold(t).startsWith(fold(w)))));

/** Tasks a search matches: every word in its title, notes or tags (folded), and every `#tag` typed (a prefix). */
export function matchesTask(q: string): (task: Task) => boolean {
  const { tags, text } = parseTagQuery(q);
  const words = fold(text).split(/\s+/).filter(Boolean);
  return (task) => matchesTags(task.tags, tags) && words.every((word) => fold(`${task.title}\n${task.notes}\n${task.tags.join(" ")}`).includes(word));
}

/** A definition's colour, or gray: what a badge is painted with. */
export const tagColor = (defs: TagDef[], name: string): Color =>
  defs.find((d) => same(d.name, name))?.color ?? "gray";
