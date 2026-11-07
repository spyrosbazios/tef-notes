// The one HTTP client of the web app: axios on the page's own origin, with failures as the core client names them
// (packages/core/src/pocketbase.ts), so the UI handles a stale rev the same way the phone and the CLI do. No sign-in:
// the private network is the gate (server/pb_migrations/1792400000_open.js).
import axios, { AxiosError } from "axios";
import { Conflict } from "@/core/pocketbase";

export const api = axios.create({ baseURL: "/api", timeout: 45_000 });

const taken = (body: any, f: string) => body?.data?.[f]?.code === "validation_not_unique";

api.interceptors.response.use(undefined, (e: AxiosError<any>) => {
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
