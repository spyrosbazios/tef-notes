// What the agent reads to file a share: a note's pictures (read_image, sent to the model as images, never stored in
// the chat) and a link's page (read_page, through the server's guarded fetch). Both taint the chat like the web.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { parseNote } from "@/core/notes";
import { fromWeb } from "../src/guard";
import { imageType } from "../src/images";
import { Notes } from "../src/notes";
import { Todo } from "../src/todo";
import { tools } from "../src/tools";
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());
const server = { url: pb.url };
const PATH = "notes/20261107-photos.md";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeEach(() => {
  pb.notes.clear(); pb.attachments.clear();
  pb.put(PATH, "---\ntitle: Photos\ncreated: 2026-11-07\n---\n![](../attachments/x/shot.png)\n");
  const id = parseNote(PATH, "").id;
  pb.attach(id, "shot.png", PNG);
  pb.attach(id, "lease.pdf", new Uint8Array([1]));
});

const all = () => tools(new Notes(server), new Todo(server)) as any;
const run = (name: string, input: object) => all()[name].execute(input, { messages: [], toolCallId: "t" });

describe("read_image", () => {
  it("keeps only which picture in the chat, and hands the model the picture itself", async () => {
    const out = await run("read_image", { path: PATH, name: "shot.png" });
    expect(out).toMatchObject({ path: PATH, name: "shot.png" });
    expect(JSON.stringify(out)).not.toContain(Buffer.from(PNG).toString("base64"));
    const m = await all().read_image.toModelOutput({ toolCallId: "t", input: {}, output: out });
    expect(m).toEqual({ type: "content", value: [
      { type: "text", text: `shot.png, attached to ${PATH}:` },
      { type: "file", mediaType: "image/png", data: { type: "data", data: Buffer.from(PNG).toString("base64") } },
    ] });
  });

  it("names the pictures a note has when the name is wrong, and takes no PDF for one", async () => {
    expect(await run("read_image", { path: PATH, name: "lease.pdf" })).toEqual({ error: `${PATH} has no picture lease.pdf. It has: shot.png.` });
    expect(await run("read_image", { path: "notes/none.md", name: "shot.png" })).toEqual({ error: "No note notes/none.md." });
    expect(await all().read_image.toModelOutput({ toolCallId: "t", input: {}, output: { error: "x" } })).toEqual({ type: "error-text", value: "x" });
  });

  it("knows a picture by its name", () => {
    expect([imageType("a.JPG"), imageType("b.png"), imageType("c.pdf"), imageType("d.excalidraw")]).toEqual(["image/jpeg", "image/png", undefined, undefined]);
  });
});

describe("read_page", () => {
  it("reads the article in a page", async () => {
    const r = await run("read_page", { url: "https://example.com/rent" });
    expect(r).toMatchObject({ url: "https://example.com/rent" });
    expect(r.text).toContain("deposit is two months");
  });

  it("refuses what the server won't fetch, and says when there is no article", async () => {
    expect(await run("read_page", { url: "ftp://x" })).toEqual({ error: "Only http(s) URLs." });
    expect(await run("read_page", { url: "http://localhost/x" })).toEqual({ error: "That page couldn't be fetched." });
    expect(await run("read_page", { url: "https://example.com/bare" })).toEqual({ error: "No article found on that page: go by its title." });
  });
});

it("taints the chat once a picture or a page was read", () => {
  const read = (toolName: string): ModelMessage[] => [{ role: "tool", content: [{ type: "tool-result", toolCallId: "t", toolName, output: { type: "json", value: {} } }] }];
  expect(fromWeb(read("read_image"))).toBe(true);
  expect(fromWeb(read("read_page"))).toBe(true);
});
