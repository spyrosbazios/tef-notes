import { describe, expect, test } from "bun:test";
import { own, refusal, sameOrigin } from "../src/request-guard";

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const request = (h: Record<string, string>, method = "POST") => new Request("http://agent:8098/agent/x", { method, headers: h, body: method === "POST" ? "{}" : undefined });

describe("sameOrigin", () => {
  test("a browser on this server's own host, or a client with no Origin at all", () => {
    expect(sameOrigin(headers({ origin: "https://notes.ts.net:8097", host: "notes.ts.net:8097" }))).toBe(true);
    expect(sameOrigin(headers({ origin: "https://notes.ts.net", "x-forwarded-host": "notes.ts.net" }))).toBe(true);
    expect(sameOrigin(headers({ origin: "https://notes.ts.net", host: "agent:8098", "x-forwarded-host": "other, notes.ts.net" }))).toBe(true);
    expect(sameOrigin(headers({}))).toBe(true);
  });

  test("another website is refused: this is what keeps one out of the socket and the routes", () => {
    expect(sameOrigin(headers({ origin: "https://evil.example", host: "notes.ts.net:8097" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "not a url", host: "notes.ts.net" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "null", host: "notes.ts.net" }))).toBe(false);          // a sandboxed frame's
  });

  test("a browser that says the request is cross-site is refused even with no Origin", () => {
    expect(sameOrigin(headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(headers({ "sec-fetch-site": "same-origin", origin: "https://notes.ts.net", host: "notes.ts.net" }))).toBe(true);
    expect(sameOrigin(headers({ "sec-fetch-site": "none" }))).toBe(true);
  });
});

describe("refusal", () => {
  const status = (h: Record<string, string>, body: Parameters<typeof refusal>[1]) => refusal(request(h), body)?.status ?? null;

  test("the web app: its own origin, JSON", () => {
    const web = { origin: "https://notes.ts.net", host: "notes.ts.net", "sec-fetch-site": "same-origin" };
    expect(status({ ...web, "content-type": "application/json" }, "json")).toBeNull();
    expect(status({ ...web, "content-type": "application/json; charset=utf-8" }, "json")).toBeNull();
    expect(status({ ...web, "content-type": "application/octet-stream" }, "bytes")).toBeNull();       // dictation
  });

  test("the clients that are not browsers send no Origin and keep working: the Android companion, PocketBase's hooks, the CLI", () => {
    expect(status({ "content-type": "application/json" }, "json")).toBeNull();                       // a task, the lens, /agent/title, drawing-picture
    expect(status({}, "none")).toBeNull();                                                           // the companion's tick has no body
  });

  test("a cross-site page's no-cors POST is refused: text/plain and form types are what such a page can send", () => {
    for (const type of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""])
      expect(status({ "content-type": type }, "json")).toBe(415);
  });

  test("a cross-site page that does send JSON is refused on its Origin", () => {
    expect(status({ origin: "https://evil.example", host: "notes.ts.net", "content-type": "application/json" }, "json")).toBe(403);
    expect(status({ origin: "https://evil.example", host: "notes.ts.net" }, "none")).toBe(403);       // a bodiless write too
    expect(status({ "sec-fetch-site": "cross-site", "content-type": "application/octet-stream" }, "bytes")).toBe(403);
  });

  test("raw bytes are asked of dictation, JSON is not taken for them", () => {
    expect(status({ "content-type": "application/json" }, "bytes")).toBe(415);
    expect(status({ "content-type": "application/octet-stream" }, "json")).toBe(415);
  });
});

describe("own", () => {
  test("runs the route for a request that passes, and answers the refusal for one that doesn't", async () => {
    let ran = 0;
    const route = own("json", () => { ran++; return new Response("ok"); });
    expect(await (await route(request({ "content-type": "application/json" }))).text()).toBe("ok");
    expect((await route(request({ "content-type": "text/plain" }))).status).toBe(415);
    expect((await route(request({ origin: "https://evil.example", "content-type": "application/json" }))).status).toBe(403);
    expect(ran).toBe(1);
  });
});

describe("index.ts", () => {
  test("every route that takes a body or changes something is behind the guard", async () => {
    const src = await Bun.file(`${import.meta.dir}/../src/index.ts`).text();
    const writes = [...src.matchAll(/\b(POST|PUT|PATCH|DELETE): (?!own\()/g)];
    expect(writes.map((m) => src.slice(m.index, m.index! + 40))).toEqual([]);
    expect([...src.matchAll(/\b(?:POST|PUT|PATCH|DELETE): own\(/g)].length).toBeGreaterThanOrEqual(10);
  });
});
