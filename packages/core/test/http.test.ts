// The one reader of a server's failure (serverError), and getJson's HttpError carrying its words.
import { afterEach, describe, expect, it } from "bun:test";
import { getJson, HttpError, serverError } from "../src/http";

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
const answer = (res: () => Response) => { globalThis.fetch = (async () => res()) as unknown as typeof fetch; };

describe("serverError", () => {
  it("reads a TEF Notes route's { error }", () => expect(serverError({ error: "No note carries the tag." })).toBe("No note carries the tag."));
  it("else PocketBase's own record API's { message }", () => expect(serverError({ message: "Failed to create record.", data: {} })).toBe("Failed to create record."));
  it("prefers { error } when both are there", () => expect(serverError({ error: "Ours.", message: "Theirs." })).toBe("Ours."));
  it("is null for a body that says neither", () => {
    for (const body of [null, undefined, "text", 7, {}, { error: "" }, { error: 3 }, { message: "  " }, []]) expect(serverError(body)).toBeNull();
  });
});

describe("getJson's failure", () => {
  it("carries the server's words as its message, its status and body beside", async () => {
    answer(() => Response.json({ error: "The server has no Anthropic key." }, { status: 503 }));
    const e = await getJson("http://x/api/tefnotes/tags/describe", { method: "POST" }, 1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status: 503, message: "The server has no Anthropic key.", body: { error: "The server has no Anthropic key." } });
  });
  it("is HTTP's status when the body says nothing", async () => {
    answer(() => new Response("<html>gone</html>", { status: 404 }));
    expect(await getJson("http://x/a", {}, 1).catch((x: unknown) => (x as Error).message)).toBe("HTTP 404");
  });
});

describe("getJson's retries", () => {
  /** A fetch that fails the first `fails` times with `fail`, then answers 200; `sent` counts what reached it. */
  function flaky(fails: number, fail: () => Response | Error) {
    const sent: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent.push(init?.method ?? "GET");
      if (sent.length <= fails) { const f = fail(); if (f instanceof Error) throw f; return f; }
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    return sent;
  }

  it("sends a write once, whatever went wrong: a reply lost after the server acted must not act twice", async () => {
    for (const method of ["POST", "PATCH", "PUT"]) {
      for (const fail of [() => new Error("socket closed"), () => new Response("{}", { status: 503 }), () => new Response("{}", { status: 429 })]) {
        const sent = flaky(5, fail);
        await getJson("http://x/a", { method }, 4).catch(() => undefined);
        expect(sent, method).toHaveLength(1);
      }
    }
  });

  it("tries a GET again after a network error", async () => {
    const sent = flaky(1, () => new Error("socket closed"));
    expect(await getJson("http://x/a", {}, 2)).toEqual({ ok: true });
    expect(sent).toEqual(["GET", "GET"]);
  });

  it("tries a DELETE again after a 5xx: a repeat that finds the record gone is a 404, which callers read as done", async () => {
    const sent = flaky(1, () => new Response("{}", { status: 502 }));
    expect(await getJson("http://x/a", { method: "DELETE" }, 2)).toEqual({ ok: true });
    expect(sent).toEqual(["DELETE", "DELETE"]);
  });
});
