// The one guard in front of every /agent route that takes a body or changes something (index.ts wraps them with `own`).
// There is no sign-in here (SECURITY.md), so the only thing between another website and the owner's notes is that a browser
// can't make a page's request look like the app's:
//  - a body of the type the route reads (JSON, or raw bytes for dictation). A `text/plain` or form POST is a "simple" request
//    that a page can send to any address without a preflight, so `await req.json()` alone let one through; application/json
//    and application/octet-stream are not, and their preflight fails: nothing here answers CORS.
//  - an `Origin` that is this server's own host, or none. A browser always names its page's origin on a POST, so a request
//    from another website carries a foreign one; a client that is not a browser (the Android companion, PocketBase's hooks
//    over the compose network, the CLI) sends none and keeps working. `Sec-Fetch-Site: cross-site` is refused too, for a
//    browser that sends it without an Origin.
// What it does not stop: a page on a name the attacker controls that resolves to this server (DNS rebinding) has this
// server's own Host. The network is the gate (SECURITY.md); this is the second lock for the browser's side of it.

/** What a route reads from the body: JSON, raw bytes, or nothing (a POST that carries no body). */
export type Body = "json" | "bytes" | "none";

const TYPE: Record<Exclude<Body, "none">, string> = { json: "application/json", bytes: "application/octet-stream" };

type Headers = { get(name: string): string | null };

/** Whether a request may come from where it says: no `Origin` (a client that is not a browser) or one on this server's own host
 *  (`Host`, or `X-Forwarded-Host` behind the reverse proxy), and not marked `Sec-Fetch-Site: cross-site`. A browser lets any
 *  website send a request, or open a WebSocket, to any address, and there is no sign-in here. */
export function sameOrigin(h: Headers): boolean {
  if (h.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = h.get("origin");
  if (origin === null) return true;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const own = [h.get("host") ?? "", ...(h.get("x-forwarded-host") ?? "").split(",")].map((x) => x.trim().toLowerCase());
  return own.includes(host);
}

/** The refusal for a request this server doesn't take (403 from another site, 415 for a body of the wrong type), or null. */
export function refusal(req: Request, body: Body): Response | null {
  if (!sameOrigin(req.headers)) return new Response("This server answers only its own app", { status: 403 });
  if (body === "none") return null;
  const sent = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return sent === TYPE[body] ? null : new Response(`Send the body as ${TYPE[body]}`, { status: 415 });
}

/** `route` behind the guard: it runs only for a request that passes (`refusal`). `body`: what the route reads. */
export const own = <R extends Request>(body: Body, route: (req: R) => Response | Promise<Response>) =>
  (req: R): Response | Promise<Response> => refusal(req, body) ?? route(req);
