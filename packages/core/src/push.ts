// Web Push, the contract between the agent (server/agent/src/push.ts, reminders.ts) and the installed web app: the key the
// browser subscribes with, the subscription it sends back, and the payload its service worker receives. Pure types and
// defensive readers, no I/O. Routes (all under the agent, no sign-in like the rest):
//   GET    /agent/push/key        -> PushKey; 404 while the server has no VAPID key (push is off)
//   POST   /agent/push/subscribe  PushSubscribeBody (a PushSubscription's toJSON() and a label) -> 204; the same endpoint again replaces it
//   DELETE /agent/push/subscribe  { endpoint } -> 204; an unknown endpoint is done
// A reminder arrives as a `push` event whose `event.data.json()` is a PushPayload (read it with `payloadOf`).

/** `GET /agent/push/key`: the VAPID public key, URL-safe base64, as `applicationServerKey` for `pushManager.subscribe`. */
export type PushKey = { publicKey: string };

/** A PushSubscription as `subscription.toJSON()` gives it. */
export type PushKeys = { p256dh: string; auth: string };

/** The body of `POST /agent/push/subscribe`. `label`: which device or browser, for the owner's own list. */
export type PushSubscribeBody = { endpoint: string; keys: PushKeys; label: string };

/** What a reminder's `push` event carries. `url` opens the task (a path on the app's origin); `tag` replaces an earlier
 *  notification of the same task instead of stacking a second. */
export type PushPayload = { title: string; body: string; task: string; url: string; tag: string };

export const PUSH_LABEL_MAX = 80;
const ENDPOINT_MAX = 2048;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A push service's endpoint: https, a named host (an IP address, `localhost` or a bare name is somewhere the agent has no
 *  business posting to), within the length the server stores. Anything else is "". This reads the text only: where the name
 *  resolves is the agent's to check before every send (`reachable`, agent/src/push.ts). */
export function endpointOf(v: unknown): string {
  const s = str(v);
  if (!s || s.length > ENDPOINT_MAX) return "";
  let u: URL;
  try { u = new URL(s); } catch { return ""; }
  const host = u.hostname;
  if (u.protocol !== "https:" || u.username || u.password) return "";
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host) || /\.(local|internal|localhost)$/.test(host)) return "";
  return s;
}

/** A subscription out of a request body; null when it is not one a browser could have made. */
export function subscriptionOf(v: unknown): PushSubscribeBody | null {
  const b = obj(v), k = obj(b.keys);
  const endpoint = endpointOf(b.endpoint), p256dh = str(k.p256dh), auth = str(k.auth);
  if (!endpoint || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth }, label: str(b.label).trim().slice(0, PUSH_LABEL_MAX) };
}

/** A path on the app's own origin (`/today?t=1`), not an absolute URL or a protocol-relative `//host`. */
const isPath = (u: string) => u.startsWith("/") && !u.startsWith("//") && !u.startsWith("/\\");

/** The payload of a `push` event; null when it is not a reminder. A `url` that is not a path on the app's origin is the task's own. */
export function payloadOf(v: unknown): PushPayload | null {
  const p = obj(v), title = str(p.title), task = str(p.task), url = str(p.url);
  return title && task ? { title, body: str(p.body), task, url: isPath(url) ? url : taskUrl(task), tag: str(p.tag) || `task:${task}` } : null;
}

/** Where a task opens in the web app: the Today list with the task beside it, `?t=<id>` (`listSearch`, web/src/lib/route-search.ts, read by the route `routes/_app/today.tsx`). */
export const taskUrl = (id: string) => `/today?t=${encodeURIComponent(id)}`;

/** The VAPID public key (`PushKey.publicKey`, URL-safe base64) as the bytes `pushManager.subscribe` takes for
 *  `applicationServerKey`. Padding is optional; null for text that is not base64url. */
export function serverKeyOf(key: string): Uint8Array<ArrayBuffer> | null {
  const s = key.trim();
  if (!/^[\w-]+={0,2}$/.test(s)) return null;
  const std = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (std.length % 4 === 1) return null;
  const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, "="));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Which device a subscription is, for the owner's own list: the browser and the system from its user-agent string
 *  ("Chrome on Android"), within `PUSH_LABEL_MAX`. */
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /Linux|X11/.test(userAgent) ? "Linux" : "";
  return (system ? `${browser} on ${system}` : browser).slice(0, PUSH_LABEL_MAX);
}
