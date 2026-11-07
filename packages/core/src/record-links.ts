// Links between records (server/pb_migrations/1793300001_links.js): one `links` record per relation, `from` → `to` with a
// role, in place of a task's single note. A task about several notes, what links to a note (its backlinks), a note or a
// task made from another note. The server's `links` also has `fromShot` and `toShot` columns, from the screenshot captures
// that are gone: no client reads or writes them (a link with one is not a link here, linkOf). Pure: the shapes, the wire columns and the questions every client asks of
// a list of links. The calls are core/pocketbase.ts `links`. (core/links.ts is something else: a pasted URL's title.)
//
// A link is never edited, only made or deleted, and carries no `rev`: it holds nothing to merge, and making or removing
// one changes neither end (neither end's `rev` moves). Both are idempotent: a create whose id, or whose (from, to, role),
// the server has already is the link meant; a delete of one gone is done. So a client syncs links as a set of ids, and
// names a new one itself (recordId) as it does a task. Either end deleted takes the link with it (the server's cascade).

/** What a link's end can be: a note or a task. */
export const LINK_TYPES = ["note", "task"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** `about`: from is about to (a task about a note; a task made from a clipped picture, about the note holding it).
 *  `source`: from was made from to (a note or task made from another note). */
export const LINK_ROLES = ["about", "source"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/** One end: the kind of record and its record id. */
export type LinkEnd = { type: LinkType; id: string };
export type Link = { id: string; from: LinkEnd; to: LinkEnd; role: LinkRole };

export type LinkSide = "from" | "to";

/** The column of one end on the wire: `fromNote`, `toTask`. */
export const linkColumn = (side: LinkSide, type: LinkType) => `${side}${type[0].toUpperCase()}${type.slice(1)}`;

/** Every end column a client sends, in the server's unique index order. */
export const LINK_COLUMNS = (["from", "to"] as const).flatMap((side) => LINK_TYPES.map((type) => linkColumn(side, type)));

const isRole = (r: unknown): r is LinkRole => (LINK_ROLES as readonly unknown[]).includes(r);

/** The one end a record names on `side`, or null when it names none or several. */
function endOf(r: any, side: LinkSide): LinkEnd | null {
  const set = LINK_TYPES.filter((t) => typeof r[linkColumn(side, t)] === "string" && r[linkColumn(side, t)]);
  return set.length === 1 ? { type: set[0], id: r[linkColumn(side, set[0])] } : null;
}

export const sameEnd = (a: LinkEnd, b: LinkEnd) => a.type === b.type && a.id === b.id;

/** Why a link can't be: one to itself, or a role there is none of; null when it can. The server refuses the same
 *  (server/pb_hooks/lib/links.js). */
export function linkProblem(l: Omit<Link, "id">): string | null {
  if (!isRole(l.role)) return `A link's role is one of ${LINK_ROLES.join(", ")}.`;
  if (sameEnd(l.from, l.to)) return "A link joins two records, not one to itself.";
  return null;
}

/** A link out of a server record; null for one that isn't (no single end on a side, an unknown role). */
export function linkOf(r: any): Link | null {
  const from = endOf(r, "from"), to = endOf(r, "to");
  if (!from || !to || !isRole(r.role)) return null;
  const l = { id: String(r.id ?? ""), from, to, role: r.role };
  return linkProblem(l) ? null : l;
}

/** A link's columns on the wire: its id, every end column ("" for those it doesn't use) and its role. */
export function linkRecord(l: Link): Record<string, string> {
  const out: Record<string, string> = { id: l.id };
  for (const c of LINK_COLUMNS) out[c] = "";
  out[linkColumn("from", l.from.type)] = l.from.id;
  out[linkColumn("to", l.to.type)] = l.to.id;
  out.role = l.role;
  return out;
}

/** A new link under the client's own id (recordId). Throws on one linkProblem refuses. */
export function newLink(id: string, from: LinkEnd, to: LinkEnd, role: LinkRole): Link {
  const l = { id, from, to, role }, why = linkProblem(l);
  if (why) throw new Error(why);
  return l;
}

/** The same relation (ends and role), whatever the ids: what the server holds one of. */
export const sameLink = (a: Omit<Link, "id">, b: Omit<Link, "id">) => sameEnd(a.from, b.from) && sameEnd(a.to, b.to) && a.role === b.role;

/** The links whose `from` is `end` (of `role`, when given). */
export const linksFrom = (links: readonly Link[], end: LinkEnd, role?: LinkRole) =>
  links.filter((l) => sameEnd(l.from, end) && (!role || l.role === role));

/** The links whose `to` is `end` (of `role`, when given): what points at it. */
export const linksTo = (links: readonly Link[], end: LinkEnd, role?: LinkRole) =>
  links.filter((l) => sameEnd(l.to, end) && (!role || l.role === role));

/** Every link with `end` at either side. */
export const linksOf = (links: readonly Link[], end: LinkEnd) => links.filter((l) => sameEnd(l.from, end) || sameEnd(l.to, end));

/** The record ids of the notes a task is about, in the order of `links`. */
export const notesOfTask = (links: readonly Link[], taskId: string) =>
  linksFrom(links, { type: "task", id: taskId }, "about").filter((l) => l.to.type === "note").map((l) => l.to.id);

/** What links to a note (its backlinks): every link whose `to` is it, of any role and from any kind of record. */
export const backlinks = (links: readonly Link[], noteId: string) => linksTo(links, { type: "note", id: noteId });

/** The tasks about a note, by id. */
export const tasksAbout = (links: readonly Link[], noteId: string) =>
  linksTo(links, { type: "note", id: noteId }, "about").filter((l) => l.from.type === "task").map((l) => l.from.id);

/** A repeating task ticked (core/todo.ts complete) goes on as a new record: its links, made again from the next round
 *  (`nextId`), each under a new id from `newId` (recordId), as the task's other fields are carried over. */
export const linksForNextRound = (links: readonly Link[], taskId: string, nextId: string, newId: () => string): Link[] =>
  linksFrom(links, { type: "task", id: taskId }).map((l) => ({ ...l, id: newId(), from: { type: "task", id: nextId } }));
