// What the server says about the pages notes link to (server link-preview route), kept on the phone: the editor's
// cards and the list's thumbnails both read it. A hit is good for a week, a page with nothing to show for an hour; when
// the server can't be reached the stale copy is used, and with none there is no card and no thumbnail, no error.
// Lookups run a few at a time, so a screenful of rows doesn't open a screenful of connections.
import { useEffect, useState } from "react";
import { HttpError } from "@/core/http";
import * as pb from "@/core/pocketbase";
import { serverOf } from "./keys";
import { previewFile } from "./storage";

type Entry = { at: number; p: pb.LinkPreview | null };      // p: null = the page has nothing to show

const FOUND = 7 * 24 * 3600_000, NONE = 3600_000, PARALLEL = 3;

function read(url: string): Entry | undefined {
  try {
    const s = previewFile.getString(url);
    return s ? (JSON.parse(s) as Entry) : undefined;
  } catch { return undefined; }
}
const write = (url: string, p: pb.LinkPreview | null) => previewFile.set(url, JSON.stringify({ at: Date.now(), p } satisfies Entry));
/** A preview kept before the server held a copy of its picture has no `picture`: asked again, once. */
const fresh = (e: Entry) => Date.now() - e.at < (e.p ? FOUND : NONE) && (!e.p || typeof e.p.picture === "string");

/** What the phone already has for `url`, however old; undefined when it never asked. */
export const cachedPreview = (url: string): pb.LinkPreview | null | undefined => read(url)?.p;

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((go) => waiting.push(go));
  active++;
  try { return await run(); } finally { active--; waiting.shift()?.(); }
}

const inflight = new Map<string, Promise<pb.LinkPreview | null>>();

async function ask(s: pb.Server, url: string, had: Entry | undefined): Promise<pb.LinkPreview | null> {
  try {
    const p = await slot(() => pb.linkPreview(s, url));
    const shown = pb.hasPreview(p) ? p : null;
    write(url, shown);
    return shown;
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) { write(url, null); return null; }       // a URL the server won't read: asking again won't change it
    if (had) return had.p;                                                                      // offline: what it had
    throw e;
  }
}

/** The preview of `url`, from the phone's copy while it is fresh, else the server's. null: nothing to show. Rejects
 *  when it can't be had at all (no server, offline, never asked before): the caller tries again some other time. */
export function linkPreview(url: string): Promise<pb.LinkPreview | null> {
  const had = read(url);
  if (had && fresh(had)) return Promise.resolve(had.p);
  const s = serverOf();
  if (!s) return had ? Promise.resolve(had.p) : Promise.reject(new Error("no notes server"));
  let run = inflight.get(url);
  if (!run) {
    run = ask(s, url, had).finally(() => inflight.delete(url));
    inflight.set(url, run);
  }
  return run;
}

/** The preview of `url` for a row: the phone's copy at once, then the server's when that is stale or missing. undefined
 *  until there is one; null when the page has nothing to show. */
export function useLinkPreview(url: string): pb.LinkPreview | null | undefined {
  const [got, setGot] = useState<{ url: string; p: pb.LinkPreview | null }>();
  useEffect(() => {
    let live = true;
    linkPreview(url).then((p) => { if (live) setGot({ url, p }); }, () => {});
    return () => { live = false; };
  }, [url]);
  return got?.url === url ? got.p : cachedPreview(url);
}
