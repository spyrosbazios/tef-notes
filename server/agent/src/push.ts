// Web Push, the agent's half (the contract is packages/core/src/push.ts): the routes a browser subscribes through, the
// subscriptions as `push_subscriptions` records (pb_migrations/1794300000_push_subscriptions.js), and `deliver`, one push
// to one of them. Reminders are scheduled by reminders.ts. The VAPID private key is the `push` key (keys.ts); the public
// one is derived from it, so there is one secret. TEF_NOTES_VAPID_SUBJECT (a `mailto:` or https URL) is the other half.
// Without either, push is off: the routes 404, nothing is sent, and the agent says so once.
import { createECDH } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import * as webpush from "web-push";
import { HttpError } from "@/core/http";
import * as pb from "@/core/pocketbase";
import { isPublicIp } from "@/core/net";
import { endpointOf, subscriptionOf, type PushKey, type PushPayload, type PushSubscribeBody } from "@/core/push";
import { key } from "./keys";

export type Vapid = { subject: string; publicKey: string; privateKey: string };

/** A push service refusing this many sends in a row loses the subscription. */
export const MAX_FAILED = 5;

/** The most subscriptions stored: one owner has a handful of devices, and every one is a place the agent posts to. A new
 *  endpoint beyond it is refused with 409 (the owner removes a device first); one already stored is always replaced. */
export const MAX_SUBSCRIPTIONS = 20;

let said = false;

/** The VAPID details, or undefined (and one log line, the first time) when push is off. Read on every use, so a key
 *  added later needs no restart. */
export async function vapid(): Promise<Vapid | undefined> {
  const privateKey = await key("push"), subject = process.env.TEF_NOTES_VAPID_SUBJECT?.trim() ?? "";
  const publicKey = privateKey ? publicOf(privateKey) : undefined;
  if (publicKey && /^(mailto:|https:\/\/)/.test(subject)) return { subject, publicKey, privateKey: privateKey! };
  if (!said) {
    said = true;
    console.error(`agent: web push is off: ${!privateKey ? "no VAPID private key (keys/push/api-key)" : !publicKey ? "the VAPID private key is not a P-256 key" : "TEF_NOTES_VAPID_SUBJECT is not a mailto: or https URL"}`);
  }
  return undefined;
}

/** The public half of a VAPID private key (32 bytes, URL-safe base64), in the form `applicationServerKey` takes; undefined
 *  when `privateKey` is not one. */
export function publicOf(privateKey: string): string | undefined {
  try {
    const raw = Buffer.from(privateKey, "base64url");
    if (raw.length !== 32) return undefined;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(raw);
    return ecdh.getPublicKey().toString("base64url");
  } catch {
    return undefined;
  }
}

// ---- subscriptions

/** A stored subscription: its record, and what `webpush` sends to. */
export type Sub = { rec: string; endpoint: string; keys: { p256dh: string; auth: string }; label: string; failed: number };

const COLLECTION = "collections/push_subscriptions/records";

const subOf = (r: any): Sub | null => {
  const s = subscriptionOf(r);
  return s && typeof r?.id === "string" ? { rec: r.id, ...s, failed: typeof r.failed === "number" ? r.failed : 0 } : null;
};

/** Every subscription. */
export async function subscriptions(server: pb.Server): Promise<Sub[]> {
  const out: Sub[] = [];
  for (let page = 1; ; page++) {
    const j = await pb.call(server, `${COLLECTION}?perPage=200&page=${page}&skipTotal=1`);
    for (const r of j.items) { const s = subOf(r); if (s) out.push(s); }
    if (j.items.length < 200) return out;
  }
}

const byEndpoint = async (server: pb.Server, endpoint: string): Promise<string | undefined> =>
  (await pb.call(server, `${COLLECTION}?fields=id&perPage=1&skipTotal=1&filter=${encodeURIComponent(`endpoint = ${pb.lit(endpoint)}`)}`)).items[0]?.id;

/** `s` stored, replacing the one of the same endpoint (a browser subscribing again may bring new keys); its failures start over.
 *  False, and nothing stored, when it is a new endpoint and `MAX_SUBSCRIPTIONS` are already kept. */
export async function save(server: pb.Server, s: PushSubscribeBody): Promise<boolean> {
  const body = { ...s, failed: 0 }, rec = await byEndpoint(server, s.endpoint);
  if (rec) { await pb.call(server, `${COLLECTION}/${rec}`, pb.json("PATCH", body)); return true; }
  if ((await subscriptions(server)).length >= MAX_SUBSCRIPTIONS) return false;
  await pb.call(server, COLLECTION, pb.json("POST", body));
  return true;
}

/** The record of `endpoint` gone. Already gone is done. */
export async function forget(server: pb.Server, endpoint: string): Promise<void> {
  const rec = await byEndpoint(server, endpoint);
  if (rec) await removeRec(server, rec);
}

async function removeRec(server: pb.Server, rec: string): Promise<void> {
  try { await pb.call(server, `${COLLECTION}/${rec}`, { method: "DELETE" }); } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
}

// ---- sending

export type Send = (sub: { endpoint: string; keys: Sub["keys"] }, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/** What came of one push. */
export type Outcome = "sent" | "gone" | "failed" | "dropped";

/** What a name resolves to, every address (`dns.lookup` with `all`). */
export type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Whether `endpoint`'s host resolves, and only to public addresses. The check in core/push.ts `endpointOf` is of the text; a
 *  DNS name can still point at loopback, the LAN or the tailnet, and the agent sits inside them. Throws when the name does not resolve. */
export async function reachable(endpoint: string, resolve: Resolve = resolveAll): Promise<boolean> {
  const ips = await resolve(new URL(endpoint).hostname);
  return ips.length > 0 && ips.every(isPublicIp);
}

/** Replaceable parts of `deliver`, for a test: the sender (`webpush.sendNotification`) and the name resolver. */
export type Deps = { send?: Send; resolve?: Resolve };

/** `payload` to `sub`, and the record kept as it should be: a 404 or 410 (the browser unsubscribed, or the subscription
 *  expired) deletes it; any other failure counts, and the fifth in a row deletes it; a success clears the count. Never throws
 *  for a push service's answer. Before every send the endpoint's host is resolved and must be public only: a subscription that
 *  is not is deleted ("dropped"), one whose name does not resolve counts as a failure. */
export async function deliver(server: pb.Server, v: Vapid, sub: Sub, payload: PushPayload, { send = webpush.sendNotification, resolve }: Deps = {}): Promise<Outcome> {
  try {
    if (!(await reachable(sub.endpoint, resolve))) {
      console.error(`agent: push endpoint ${new URL(sub.endpoint).hostname} resolves to a private address: subscription removed`);
      await removeRec(server, sub.rec);
      return "dropped";
    }
    await send({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
      vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 3600, urgency: "high", timeout: 15_000,
    });
    if (sub.failed) await pb.call(server, `${COLLECTION}/${sub.rec}`, pb.json("PATCH", { failed: 0 }));
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) { await removeRec(server, sub.rec); return "gone"; }
    console.error(`agent: push to ${new URL(sub.endpoint).hostname} failed (${status ?? (e as Error).message})`);
    if (sub.failed + 1 >= MAX_FAILED) { await removeRec(server, sub.rec); return "dropped"; }
    await pb.call(server, `${COLLECTION}/${sub.rec}`, pb.json("PATCH", { failed: sub.failed + 1 }));
    return "failed";
  }
}

// ---- routes

const off = () => new Response("Push is off", { status: 404 });
const noBody = () => new Response(null, { status: 204 });
const bad = (message: string) => Response.json({ error: message }, { status: 400 });

/** GET /agent/push/key */
export async function keyRoute(): Promise<Response> {
  const v = await vapid();
  return v ? Response.json({ publicKey: v.publicKey } satisfies PushKey) : off();
}

/** POST /agent/push/subscribe */
export async function subscribeRoute(req: Request, server: pb.Server): Promise<Response> {
  if (!(await vapid())) return off();
  const s = subscriptionOf(await req.json().catch(() => undefined));
  if (!s) return bad("Not a push subscription");
  if (!(await save(server, s))) return Response.json({ error: `At most ${MAX_SUBSCRIPTIONS} devices: remove one first` }, { status: 409 });
  return noBody();
}

/** DELETE /agent/push/subscribe, body `{ endpoint }` */
export async function unsubscribeRoute(req: Request, server: pb.Server): Promise<Response> {
  const endpoint = endpointOf(((await req.json().catch(() => undefined)) as { endpoint?: unknown } | undefined)?.endpoint);
  if (!endpoint) return bad("No endpoint");
  await forget(server, endpoint);
  return noBody();
}
