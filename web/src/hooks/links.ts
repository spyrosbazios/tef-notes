// The links (core/record-links.ts) as TanStack Query state: one list of every link (a personal notebook's are few), the
// server's reply put straight into it on a write and the realtime feed putting in what another device made or removed.
// No rev and no merge: a link is only made or deleted, and both are idempotent (services/links.ts).
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { recordId } from "@/core/pocketbase";
import { linksForNextRound, newLink, type Link, type LinkEnd, type LinkRole } from "@/core/record-links";
import { applyLinkChange, withoutEnd } from "@/lib/links";
import * as svc from "@/services/links";

export const LINKS = ["links"] as const;

export const useLinks = () => useQuery({ queryKey: LINKS, queryFn: () => svc.all(), refetchOnWindowFocus: true });

/** The cache after a write: a refetch still out started before it and would undo it, so it is cancelled and run again. */
async function commit(qc: QueryClient, edit: (all: Link[]) => Link[]) {
  const out = qc.isFetching({ queryKey: LINKS }) > 0;
  await qc.cancelQueries({ queryKey: LINKS });
  qc.setQueryData<Link[]>(LINKS, (all) => (all ? edit(all) : all));
  if (out) void qc.invalidateQueries({ queryKey: LINKS });
}

/** `from` linked to `to` as `role`, under a new id; the server's copy goes into the cache (it may be one it had already). */
export async function addLink(qc: QueryClient, from: LinkEnd, to: LinkEnd, role: LinkRole): Promise<Link> {
  const l = await svc.add(newLink(recordId(), from, to, role));
  await commit(qc, (all) => [...all.filter((x) => x.id !== l.id), l]);
  return l;
}

/** A link gone (already gone is done). */
export async function removeLink(qc: QueryClient, id: string): Promise<void> {
  await svc.remove(id);
  await commit(qc, (all) => all.filter((x) => x.id !== id));
}

/** A repeating task's next round gets the links of the round just done, each under a new id (core/record-links.ts
 *  linksForNextRound). Read from the server, not the cache: a link made on another device a moment ago goes along too. */
export async function carryLinks(qc: QueryClient, taskId: string, nextId: string): Promise<void> {
  const next = linksForNextRound(await svc.from({ type: "task", id: taskId }), taskId, nextId, recordId);
  const made = await Promise.all(next.map(svc.add));
  if (made.length) await commit(qc, (all) => [...all.filter((x) => !made.some((m) => m.id === x.id)), ...made]);
}

/** A change from the realtime feed, into the cache. */
export function applyLink(qc: QueryClient, action: string, record: unknown) {
  qc.setQueryData<Link[]>(LINKS, (all) => (all ? applyLinkChange(all, action, record) : all));
}

/** A note or a task gone takes its links with it (the server's cascade): they leave the cache with it. */
export function forgetEnd(qc: QueryClient, end: LinkEnd) {
  qc.setQueryData<Link[]>(LINKS, (all) => (all ? withoutEnd(all, end) : all));
}
