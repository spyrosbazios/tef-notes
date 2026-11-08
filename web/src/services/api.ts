// The one HTTP client of the web app: axios on the page's own origin, with failures as the core client names them
// (packages/core/src/pocketbase.ts), so the UI handles a stale rev the same way the phone and the CLI do. No sign-in:
// the private network is the gate (server/pb_migrations/1792400000_open.js).
import axios, { AxiosError } from "axios";
import { Conflict } from "@/core/pocketbase";
import { getNet, note } from "@/lib/net";

export const api = axios.create({ baseURL: "/api", timeout: 45_000 });

/** Which writes wait for the server and which fail at once. The notes, tasks and links are written to the local copy first and
 *  sent by the sync engine (lib/sync.ts, packages/core/src/sync.ts), which names the `rev` each was based on, so those requests
 *  go out marked `synced` and are tried whatever the browser says: the engine only sends when it thinks the network is there,
 *  and a request that fails leaves the edit waiting. Every other write (attachment uploads, tags, lenses, push subscriptions)
 *  has no local copy to wait in, so while the browser is offline it is refused up front with `Offline`, and the caller toasts it
 *  (a server that merely isn't answering is tried: the request fails at the network, fast). */
export const synced = { synced: true } as const;

declare module "axios" {
  interface AxiosRequestConfig { /** Sent by the sync engine: not refused up front while offline (see `synced`). */ synced?: boolean }
}

/** A write with no local copy to wait in, refused because the browser is offline. */
export class Offline extends Error {
  constructor() { super("You're offline: this can't be saved until the server is reachable."); }
}

api.interceptors.request.use((c) => {
  if (!c.synced && c.method && c.method.toLowerCase() !== "get" && !getNet().browser) return Promise.reject(new Offline());
  return c;
});

const taken = (body: any, f: string) => body?.data?.[f]?.code === "validation_not_unique";

api.interceptors.response.use((r) => { note("reached"); return r; }, (e: AxiosError<any>) => {
  if (e.response) note("reached");
  else if (e.code === AxiosError.ERR_NETWORK) note("unreachable");
  const status = e.response?.status, body = e.response?.data, what = e.config?.url ?? "";
  if (status === 409) return Promise.reject(new Conflict(body?.message ?? what));
  if (status === 400 && (taken(body, "path") || taken(body, "note") || taken(body, "name") || taken(body, "id"))) return Promise.reject(new Conflict(what));
  return Promise.reject(e);
});

/** 404 as null: a record that's gone. */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (e) {
    if (e instanceof AxiosError && e.response?.status === 404) return null;
    throw e;
  }
}

/** A filter literal: PocketBase's are double-quoted, with backslash escapes. */
export const lit = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** What went wrong, in words for a toast. */
export function message(e: unknown): string {
  if (e instanceof AxiosError) return e.response?.data?.message ?? e.response?.data?.error ?? (e.response ? `HTTP ${e.response.status}` : "The server can't be reached.");
  return e instanceof Error ? e.message : String(e);
}
