// The routes and the subscription records over a small fake PocketBase, deliver's reading of a push service's answers, and
// that web-push builds an encrypted request under bun. The VAPID key here is made for the test and is nobody's.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createECDH, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as webpush from "web-push";

type Rec = Record<string, any> & { id: string };
const recs = new Map<string, Rec>();
let n = 0;
const fake = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url), m = /^\/api\/collections\/push_subscriptions\/records(?:\/([\w-]+))?$/.exec(u.pathname);
    if (!m) return new Response("no", { status: 404 });
    const id = m[1];
    if (req.method === "GET") {
      const f = /endpoint = "(.*)"/.exec(u.searchParams.get("filter") ?? "");
      return Response.json({ items: [...recs.values()].filter((r) => !f || r.endpoint === f[1]) });
    }
    if (req.method === "POST") { const r = { ...(await req.json()), id: `r${++n}` } as Rec; recs.set(r.id, r); return Response.json(r); }
    if (!id || !recs.has(id)) return new Response("{}", { status: 404 });
    if (req.method === "PATCH") { Object.assign(recs.get(id)!, await req.json()); return Response.json(recs.get(id)); }
    recs.delete(id);
    return new Response(null, { status: 204 });
  },
});
const server = { url: `http://127.0.0.1:${fake.port}` };
const env = { keys: process.env.TEF_NOTES_KEYS_DIR, subject: process.env.TEF_NOTES_VAPID_SUBJECT };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
afterAll(() => {
  fake.stop();
  restore("TEF_NOTES_KEYS_DIR", env.keys);
  restore("TEF_NOTES_VAPID_SUBJECT", env.subject);
});

const dir = mkdtempSync(join(tmpdir(), "tef-push-"));
const vapidKeys = webpush.generateVAPIDKeys();
mkdirSync(join(dir, "push"));
writeFileSync(join(dir, "push", "api-key"), `${vapidKeys.privateKey}\n`);
process.env.TEF_NOTES_KEYS_DIR = dir;
process.env.TEF_NOTES_VAPID_SUBJECT = "mailto:owner@example.com";
const push = await import("../src/push");

const browser = createECDH("prime256v1"); browser.generateKeys();
const keys = { p256dh: browser.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const endpoint = "https://fcm.googleapis.com/fcm/send/abc:123";
const post = (body: unknown, method = "POST") => new Request("http://x/agent/push/subscribe", { method, body: JSON.stringify(body) });

beforeAll(() => recs.clear());

describe("the VAPID key", () => {
  it("derives the public key web-push generated, and refuses a key that is not one", () => {
    expect(push.publicOf(vapidKeys.privateKey)).toBe(vapidKeys.publicKey);
    expect(push.publicOf("short")).toBeUndefined();
  });
  it("GET /agent/push/key serves it", async () => {
    expect(await (await push.keyRoute()).json()).toEqual({ publicKey: vapidKeys.publicKey });
  });
});

describe("subscribe and unsubscribe", () => {
  it("stores a subscription, and the same endpoint again replaces it", async () => {
    expect((await push.subscribeRoute(post({ endpoint, keys, label: "Laptop" }), server)).status).toBe(204);
    recs.get("r1")!.failed = 3;
    expect((await push.subscribeRoute(post({ endpoint, keys, label: "Laptop, Firefox" }), server)).status).toBe(204);
    expect([...recs.values()]).toHaveLength(1);
    expect(recs.get("r1")).toMatchObject({ endpoint, label: "Laptop, Firefox", failed: 0 });
    expect(await push.subscriptions(server)).toEqual([{ rec: "r1", endpoint, keys, label: "Laptop, Firefox", failed: 0 }]);
  });
  it("refuses a body that is not a subscription", async () => {
    expect((await push.subscribeRoute(post({ endpoint: "http://localhost/x", keys }), server)).status).toBe(400);
    expect((await push.subscribeRoute(new Request("http://x", { method: "POST", body: "nope" }), server)).status).toBe(400);
    expect(recs.size).toBe(1);
  });
  it("DELETE removes by endpoint; an unknown one is done", async () => {
    expect((await push.unsubscribeRoute(post({ endpoint: "https://other.example.com/x" }, "DELETE"), server)).status).toBe(204);
    expect(recs.size).toBe(1);
    expect((await push.unsubscribeRoute(post({ endpoint }, "DELETE"), server)).status).toBe(204);
    expect(recs.size).toBe(0);
    expect((await push.unsubscribeRoute(post({}, "DELETE"), server)).status).toBe(400);
  });
  it("refuses a new device beyond the cap with 409, and still replaces a stored one", async () => {
    recs.clear();
    for (let i = 0; i < push.MAX_SUBSCRIPTIONS; i++)
      expect((await push.subscribeRoute(post({ endpoint: `https://push${i}.example.com/x`, keys, label: "" }), server)).status).toBe(204);
    expect((await push.subscribeRoute(post({ endpoint: "https://one-too-many.example.com/x", keys, label: "" }), server)).status).toBe(409);
    expect(recs.size).toBe(push.MAX_SUBSCRIPTIONS);
    expect((await push.subscribeRoute(post({ endpoint: "https://push3.example.com/x", keys, label: "again" }), server)).status).toBe(204);
    expect(recs.size).toBe(push.MAX_SUBSCRIPTIONS);
    recs.clear();
  });
});

describe("deliver", () => {
  const v = { subject: "mailto:owner@example.com", publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey };
  const payload = { title: "Call", body: "09:00", task: "t1", url: "/today?t=t1", tag: "task:t1" };
  const refuse = (statusCode: number) => async () => { throw Object.assign(new Error("refused"), { statusCode }); };
  const publicDns = async () => ["142.250.74.14", "2a00:1450:4001:81b::200e"];
  const stored = async (failed = 0) => {
    recs.clear();
    await push.save(server, { endpoint, keys, label: "" });
    recs.forEach((r) => (r.failed = failed));
    return (await push.subscriptions(server))[0];
  };

  it("sends the payload and clears earlier failures", async () => {
    let sent = "";
    const s = await stored(2);
    expect(await push.deliver(server, v, s, payload, { resolve: publicDns, send: async (_s, body) => { sent = body; } })).toBe("sent");
    expect(JSON.parse(sent)).toEqual(payload);
    expect([...recs.values()][0].failed).toBe(0);
  });
  it("deletes a subscription the push service says is gone (404, 410)", async () => {
    for (const code of [404, 410]) {
      expect(await push.deliver(server, v, await stored(), payload, { resolve: publicDns, send: refuse(code) })).toBe("gone");
      expect(recs.size).toBe(0);
    }
  });
  it("counts other failures and drops the subscription at the fifth in a row", async () => {
    const s = await stored();
    expect(await push.deliver(server, v, s, payload, { resolve: publicDns, send: refuse(500) })).toBe("failed");
    expect([...recs.values()][0].failed).toBe(1);
    expect(await push.deliver(server, v, await stored(push.MAX_FAILED - 1), payload, { resolve: publicDns, send: refuse(503) })).toBe("dropped");
    expect(recs.size).toBe(0);
  });
});

describe("the endpoint's address", () => {
  const v = { subject: "mailto:owner@example.com", publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey };
  const payload = { title: "Call", body: "09:00", task: "t1", url: "/today?t=t1", tag: "task:t1" };
  it("is public when every address a name resolves to is", async () => {
    expect(await push.reachable(endpoint, async () => ["8.8.8.8", "2606:4700::1111"])).toBe(true);
    for (const ips of [["127.0.0.1"], ["8.8.8.8", "10.0.0.5"], ["169.254.169.254"], ["100.86.234.101"], ["fd00::1"], ["fe80::1"], ["::1"], ["::ffff:192.168.1.1"], []])
      expect(await push.reachable(endpoint, async () => ips)).toBe(false);
  });
  it("deliver sends nothing to a name that resolves privately, and deletes the subscription", async () => {
    recs.clear();
    await push.save(server, { endpoint, keys, label: "" });
    const s = (await push.subscriptions(server))[0];
    let sent = false;
    const send = async () => { sent = true; };
    expect(await push.deliver(server, v, s, payload, { resolve: async () => ["127.0.0.1"], send })).toBe("dropped");
    expect(sent).toBe(false);
    expect(recs.size).toBe(0);
  });
  it("deliver counts a name that does not resolve as a failure, and sends nothing", async () => {
    recs.clear();
    await push.save(server, { endpoint, keys, label: "" });
    const s = (await push.subscriptions(server))[0];
    let sent = false;
    const resolve = async (): Promise<string[]> => { throw new Error("ENOTFOUND"); };
    expect(await push.deliver(server, v, s, payload, { resolve, send: async () => { sent = true; } })).toBe("failed");
    expect(sent).toBe(false);
    expect([...recs.values()][0].failed).toBe(1);
  });
});

describe("web-push under bun", () => {
  it("builds an encrypted, VAPID-signed request for a subscription", () => {
    const d = webpush.generateRequestDetails({ endpoint, keys }, "hello", {
      vapidDetails: { subject: "mailto:owner@example.com", publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey }, TTL: 60,
    });
    expect(d.method).toBe("POST");
    expect(d.headers.Authorization).toMatch(/^vapid t=/);
    expect(d.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(Buffer.from(d.body as Buffer).length).toBeGreaterThan(5);
  });
});
