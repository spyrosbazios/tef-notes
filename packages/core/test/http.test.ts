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
