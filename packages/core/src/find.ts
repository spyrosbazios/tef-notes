// Search by asking: when the search box finds nothing, the agent looks for what was meant. `POST /agent/find { q }`
// (server/agent/src/find.ts, whose answer the compiler holds to `Found`) runs a short read-only loop over the notes'
// and tasks' search tools and answers with the hits, never a chat: nothing is saved, nothing written. Here: the shape,
// the route, and the one defensive reading of the answer.

/** One hit: a note by its path or a task by its id, and why it answers the query, in the query's language. */
export type FoundNote = { path: string; why: string };
export type FoundTask = { id: string; why: string };
export type Found = { notes: FoundNote[]; tasks: FoundTask[] };

/** The route under the agent's `/agent/`. */
export const FIND_PATH = "find";

/** At most this many of each. */
export const FOUND_MAX = 10;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** The server's answer as `Found`; hits without a path or id dropped, a path taken once. */
export function foundOf(x: unknown): Found {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const once = <T extends { key: string }>(xs: T[]) => xs.filter((h, i) => h.key && xs.findIndex((y) => y.key === h.key) === i);
  const notes = once(list(o.notes).map((h) => ({ key: str(h.path), why: str(h.why) }))).slice(0, FOUND_MAX);
  const tasks = once(list(o.tasks).map((h) => ({ key: str(h.id), why: str(h.why) }))).slice(0, FOUND_MAX);
  return { notes: notes.map((h) => ({ path: h.key, why: h.why })), tasks: tasks.map((h) => ({ id: h.key, why: h.why })) };
}

// Search by words and meaning, no model loop: `GET /agent/search?q=&limit=` (server/agent/src/search.ts), the agent's
// own `search_notes` (words fused with the local embedding model's nearest notes). The CLI's `search`.

/** One note it found; `match`: by its words, its meaning, or both. A meaning-only match may be loose. */
export type SearchHit = { path: string; title: string; snippet: string; match: "words" | "meaning" | "both" };

export const SEARCH_PATH = "search";
export const SEARCH_MAX = 30;

const MATCHES = new Set(["words", "meaning", "both"]);

/** The server's answer as hits; one without a note path dropped. */
export function searchHitsOf(x: unknown): SearchHit[] {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return list(o.results).flatMap((h) => {
    const path = str(h.path);
    if (!path.startsWith("notes/")) return [];
    const match = MATCHES.has(str(h.match)) ? (str(h.match) as SearchHit["match"]) : "words";
    return [{ path, title: str(h.title) || path, snippet: str(h.snippet), match }];
  }).slice(0, SEARCH_MAX);
}
