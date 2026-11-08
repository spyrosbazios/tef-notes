// The links (core/record-links.ts) as TanStack Query state, over the local copy (lib/local.ts): one list of every link (a personal
// notebook's are few), read from the copy. A link is only made or deleted, no rev and no merge: a made one goes up when its
// task has (an add is idempotent), a deleted one is a tombstone until the server has dropped it (packages/core/src/sync.ts).
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { recordId } from "@/core/pocketbase";
import { type Link, type LinkEnd, type LinkRole } from "@/core/record-links";
import { addLink as makeLink, removeLink as dropLink, visibleLinks } from "@/core/sync";
import { local } from "@/lib/local";
import { edited, LOCAL_QUERY, opened, syncing } from "@/lib/sync";

export const LINKS = ["links"] as const;

export const projectLinks = (qc: QueryClient) => qc.setQueryData<Link[]>(LINKS, visibleLinks(local));

export const useLinks = () => useQuery({ queryKey: LINKS, queryFn: async () => { await opened(); return visibleLinks(local); }, ...LOCAL_QUERY });

/** `from` linked to `to` as `role`, under a new id (the link already there, when this relation is); the sync sends it. */
export async function addLink(qc: QueryClient, from: LinkEnd, to: LinkEnd, role: LinkRole): Promise<Link> {
  const id = makeLink(local, recordId(), from, to, role);
  projectLinks(qc);
  edited();
  return local.links.get(id)!.link;
}

/** A link gone (already gone is done). */
export async function removeLink(qc: QueryClient, id: string): Promise<void> {
  dropLink(local, id, syncing());
  projectLinks(qc);
  edited();
}
