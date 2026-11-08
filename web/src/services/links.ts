// Links between records on the server, as the sync engine (lib/sync.ts) calls them, every request marked `synced` (services/api.ts)
// (core/record-links.ts; ARCHITECTURE.md, "Links"): made and deleted, never edited, no `rev`. Both calls are idempotent, as the core client's are (core/pocketbase.ts `links`): a create the server already
// has (that id, or the same ends and role) comes back as the server holds it, and a delete of one gone is done.
import { AxiosError } from "axios";
import { Conflict, linkFilter } from "@/core/pocketbase";
import { LINK_COLUMNS, linkOf, linkRecord, sameLink, type Link } from "@/core/record-links";
import { api, lit, orNull, synced } from "./api";

const PAGE = 500;
const FIELDS = ["id", ...LINK_COLUMNS, "role"].join(",");
const PATH = "collections/links/records";

const LINK_BATCH = 40;

/** Every link's id: what a pull compares the local copy's set against (an id never changes what it points at). */
export async function ids(): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get(PATH, { params: { fields: "id", sort: "id", perPage: PAGE, page, skipTotal: 1 }, ...synced });
    out.push(...data.items.map((r: any) => String(r.id)));
    if (data.items.length < PAGE) return out;
  }
}

/** The links with `filter` (a PocketBase filter), oldest first. A record that isn't a link is left out. */
async function listWhere(filter: string): Promise<Link[]> {
  const out: Link[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get(PATH, { params: { fields: FIELDS, sort: "created,id", perPage: PAGE, page, skipTotal: 1, filter }, ...synced });
    for (const r of data.items) { const l = linkOf(r); if (l) out.push(l); }
    if (data.items.length < PAGE) return out;
  }
}

/** The links of these ids the server has, a few dozen a request. */
export async function byIds(want: string[]): Promise<Link[]> {
  const out: Link[] = [];
  for (let i = 0; i < want.length; i += LINK_BATCH) out.push(...(await listWhere(want.slice(i, i + LINK_BATCH).map((id) => `id = ${lit(id)}`).join(" || "))));
  return out;
}

/** `l` made under its own id. Idempotent: one the server has by that id, or another of the same ends and role, is the link
 *  meant and comes back as the server holds it. A 404 is an end that is gone; any other 400 a link the server refuses. */
export async function add(l: Link): Promise<Link> {
  try {
    const { data } = await api.post(PATH, linkRecord(l), { params: { fields: FIELDS }, ...synced });
    return linkOf(data) ?? l;
  } catch (e) {
    if (!(e instanceof Conflict) && !(e instanceof AxiosError && e.response?.status === 400)) throw e;
    const had = (await listWhere(linkFilter("from", l.from))).find((x) => x.id === l.id || sameLink(x, l));
    if (had) return had;
    throw e;
  }
}

/** A link gone. Already gone is done. */
export async function remove(id: string): Promise<void> {
  await orNull(api.delete(`${PATH}/${id}`, synced));
}
