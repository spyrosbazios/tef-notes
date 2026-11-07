// Links between records on the server (core/record-links.ts; ARCHITECTURE.md, "Links"): made and deleted, never edited,
// no `rev`. Both calls are idempotent, as the core client's are (core/pocketbase.ts `links`): a create the server already
// has (that id, or the same ends and role) comes back as the server holds it, and a delete of one gone is done.
import { AxiosError } from "axios";
import { Conflict, linkFilter } from "@/core/pocketbase";
import { LINK_COLUMNS, linkOf, linkRecord, sameLink, type Link, type LinkEnd } from "@/core/record-links";
import { api, orNull } from "./api";

const PAGE = 500;
const FIELDS = ["id", ...LINK_COLUMNS, "role"].join(",");
const PATH = "collections/links/records";

/** Every link, or those a PocketBase `filter` picks, oldest first. A record that isn't a link is left out. */
export async function all(filter?: string): Promise<Link[]> {
  const out: Link[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get(PATH, { params: { fields: FIELDS, sort: "created,id", perPage: PAGE, page, skipTotal: 1, ...(filter ? { filter } : {}) } });
    for (const r of data.items) { const l = linkOf(r); if (l) out.push(l); }
    if (data.items.length < PAGE) return out;
  }
}

/** The links with `end` as their `from`. */
export const from = (end: LinkEnd) => all(linkFilter("from", end));

/** `l` made under its own id. Idempotent: one the server has by that id, or another of the same ends and role, is the link
 *  meant and comes back as the server holds it. A 404 is an end that is gone; any other 400 a link the server refuses. */
export async function add(l: Link): Promise<Link> {
  try {
    const { data } = await api.post(PATH, linkRecord(l), { params: { fields: FIELDS } });
    return linkOf(data) ?? l;
  } catch (e) {
    if (!(e instanceof Conflict) && !(e instanceof AxiosError && e.response?.status === 400)) throw e;
    const had = (await from(l.from)).find((x) => x.id === l.id || sameLink(x, l));
    if (had) return had;
    throw e;
  }
}

/** A link gone. Already gone is done. */
export async function remove(id: string): Promise<void> {
  await orNull(api.delete(`${PATH}/${id}`));
}
