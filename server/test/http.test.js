// lib/http.js: the one error shape every TEF Notes route answers, `{ error }`, and the catch-all that keeps an unexpected
// throw in it; and the hooks held to it, read as source (a route runs only inside PocketBase).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import lib from "../pb_hooks/lib/http.js";

const HOOKS = join(import.meta.dir, "../pb_hooks");
const hooks = readdirSync(HOOKS).filter((f) => f.endsWith(".pb.js")).map((f) => ({ f, src: readFileSync(join(HOOKS, f), "utf8") }));
// The record API's request hooks refuse a write inside PocketBase's own API, whose answers are PocketBase's `{ message }`
const RECORD_HOOKS = ["rev.pb.js", "notes.pb.js", "links.pb.js", "tainted.pb.js"];

/** A request event: `json` answers are kept, `logged` the logger's error lines. */
const event = () => {
  const e = { sent: null, logged: [], json: (status, body) => (e.sent = { status, body }), app: { logger: () => ({ error: (...a) => e.logged.push(a) }) } };
  return e;
};

describe("route", () => {
  test("answers what the handler answers", () => {
    const e = event();
    expect(lib.route(e, "x", "It failed.", () => e.json(200, { ok: true }))).toEqual({ status: 200, body: { ok: true } });
    expect(e.logged).toEqual([]);
  });
  test("a throw is a 500 { error }, logged, never PocketBase's { message }", () => {
    const e = event();
    lib.route(e, "tags", "The tag could not be renamed.", () => { throw new Error("database is locked"); });
    expect(e.sent).toEqual({ status: 500, body: { error: "The tag could not be renamed." } });
    expect(e.logged[0][0]).toBe("tags: The tag could not be renamed.");
    expect(String(e.logged[0][2])).toContain("database is locked");
  });
});

describe("the hooks", () => {
  test("every route runs through route()", () => {
    for (const { f, src } of hooks) {
      for (const m of src.matchAll(/routerAdd\("[A-Z]+", "[^"]+", \(e\) => (.{0,60})/g)) expect([f, m[1]]).toEqual([f, expect.stringContaining("lib/http.js`).route(e, ")]);
    }
  });
  test("every failure a route answers is { error }", () => {
    for (const { f, src } of hooks) {
      for (const m of src.matchAll(/e\.json\((\d{3}),\s*([^)]{0,12})/g)) if (Number(m[1]) >= 400) expect([f, m[2]]).toEqual([f, expect.stringMatching(/^\{ error\b/)]);
      expect([f, /\{\s*message\s*:/.test(src)]).toEqual([f, false]);
    }
  });
  test("no route throws PocketBase's ApiErrors, whose answer is { message }", () => {
    for (const { f, src } of hooks) if (!RECORD_HOOKS.includes(f)) expect([f, /\b(BadRequestError|NotFoundError|ForbiddenError|ApiError)\b/.test(src)]).toEqual([f, false]);
  });
});
