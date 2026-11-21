// The links (core/record-links.ts) as TanStack Query state, over the local copy: one list of every link (a personal notebook's
// are few), read from the copy. A link is only made or deleted, no rev and no merge: a made one goes up when its task has (an
// add is idempotent), a deleted one is a tombstone until the server has dropped it (packages/core/src/sync.ts). Writes:
// lib/records.ts.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { LINKS, LOCAL_QUERY, opened, readLinks } from "@/lib/records";

export { LINKS } from "@/lib/records";
export { addLink, removeLink } from "@/lib/records";

export const linksQuery = queryOptions({ queryKey: LINKS, queryFn: async () => { await opened(); return readLinks(); }, ...LOCAL_QUERY });

export const useLinks = () => useQuery(linksQuery);
