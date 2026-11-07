// fetch with a timeout and backoff on 429 / 5xx — the urllib retry loops in pnl.py and pnl_evm.py.

export class HttpError extends Error {
  /** `body`: the error's JSON, when it sent some — PocketBase's names the field a validation failed on. */
  constructor(public status: number, message: string, public headers?: Headers, public body?: any) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A read gets 15 s a try, a write 45 s: on a dead network a listing gives up in seconds, not after a write's patience. */
const patience = (init: RequestInit) => (!init.method || init.method === "GET" ? 15_000 : 45_000);

export async function getJson(url: string, init: RequestInit = {}, tries = 4, timeoutMs = patience(init)): Promise<any> {
  for (let i = 0; ; i++) {
    const ctl = new AbortController(), stop = () => ctl.abort();
    const timer = setTimeout(stop, timeoutMs);
    init.signal?.addEventListener("abort", stop, { once: true });     // the caller's Stop ends the request, not just the timeout
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (r.ok) return r.status === 204 ? null : await r.json();
      const retry = r.status === 429 || r.status >= 500;
      if (!retry || i === tries - 1) throw new HttpError(r.status, `HTTP ${r.status}`, r.headers, await r.json().catch(() => undefined));
    } catch (e) {
      if (e instanceof HttpError || init.signal?.aborted || i === tries - 1) throw e;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", stop);
    }
    await sleep(1500 * 2 ** i);
  }
}
