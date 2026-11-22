// fetch with a timeout, and backoff on a network error, 429 or 5xx for a request that is safe to send twice: a GET, or a
// DELETE (a repeat that finds the record gone is a 404, which every caller reads as done). A POST, PATCH or PUT is sent once:
// a reply lost after the server acted would have it act twice (a second create, an append added twice, a claim read as taken).
// A caller that must survive a lost reply sends a write under an id of its own and sends it again itself, where it can read what
// a clash on that id means (record-protocol.ts `createdUnder`, record-contracts.ts `landed`).
import { serverError } from "../record-contracts";

export class HttpError extends Error {
  /** `body`: the error's JSON, when it sent some — PocketBase's names the field a validation failed on. */
  constructor(public status: number, message: string, public headers?: Headers, public body?: any) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A read gets 15 s a try, a write 45 s: on a dead network a listing gives up in seconds, not after a write's patience. */
const patience = (init: RequestInit) => (!init.method || init.method === "GET" ? 15_000 : 45_000);

/** Whether sending `init` twice is the same as once. */
const repeatable = (init: RequestInit) => !init.method || init.method === "GET" || init.method === "DELETE";

export async function getJson(url: string, init: RequestInit = {}, triesAllowed = 4, timeoutMs = patience(init)): Promise<any> {
  const tries = repeatable(init) ? triesAllowed : 1;
  for (let i = 0; ; i++) {
    const ctl = new AbortController(), stop = () => ctl.abort();
    const timer = setTimeout(stop, timeoutMs);
    init.signal?.addEventListener("abort", stop, { once: true });     // the caller's Stop ends the request, not just the timeout
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (r.ok) return r.status === 204 ? null : await r.json();
      const retry = r.status === 429 || r.status >= 500;
      if (!retry || i === tries - 1) {
        const body = await r.json().catch(() => undefined);
        throw new HttpError(r.status, serverError(body) ?? `HTTP ${r.status}`, r.headers, body);
      }
    } catch (e) {
      if (e instanceof HttpError || init.signal?.aborted || i === tries - 1) throw e;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", stop);
    }
    await sleep(1500 * 2 ** i);
  }
}
