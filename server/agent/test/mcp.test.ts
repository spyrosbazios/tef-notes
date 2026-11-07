// The MCP endpoint (mcp.ts) through the SDK's own client: which tools it offers and how they're marked, a read, a write
// marked tainted, and a tool's error as an MCP error result. Against a fake PocketBase (fake-pb.ts).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcp, MCP_TOOLS } from "../src/mcp";
import { fakePb } from "./fake-pb";

const pb = fakePb();
const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => mcp(req, { url: pb.url }) });
afterAll(() => { pb.stop(); srv.stop(true); });

async function connect() {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/agent/mcp`)));
  return client;
}
const json = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0].text);

beforeEach(() => {
  pb.notes.clear(); pb.tasks.clear(); pb.links.clear(); pb.created.length = 0; pb.meanwhile();
  pb.tags.splice(0, pb.tags.length, { id: "t1", name: "work", description: "" });
});

describe("mcp", () => {
  it("offers the note and task tools, none of the chat's own, marked read or write", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
    for (const no of ["web_search", "read_url", "update_memory", "show_items", "open_note", "ask_choice", "show_day", "show_link", "find_free_slots"]) expect(tools.some((t) => t.name === no)).toBe(false);
    const by = new Map(tools.map((t) => [t.name, t]));
    expect(by.get("read_note")?.annotations?.readOnlyHint).toBe(true);
    expect(by.get("create_note")?.annotations?.readOnlyHint).toBe(false);
    expect(by.get("delete_task")?.annotations?.destructiveHint).toBe(true);
    expect(by.get("delete_note")?.annotations?.destructiveHint).toBe(true);
    expect(by.get("search_notes")?.inputSchema.properties).toHaveProperty("query");
    expect(c.getInstructions()).toContain("Today is");
    await c.close();
  });

  it("creates and partially updates tag definitions through MCP", async () => {
    const c = await connect();
    const made = json(await c.callTool({ name: "create_tag", arguments: { name: "travel", description: "Trips" } }));
    expect(made.tag.name).toBe("travel");
    const changed = json(await c.callTool({ name: "update_tag", arguments: { id: made.tag.rec, color: "blue" } }));
    expect(changed.tag).toMatchObject({ name: "travel", description: "Trips", color: "blue" });
    const listed = json(await c.callTool({ name: "list_tags", arguments: {} }));
    expect(listed.tags).toContainEqual({ id: made.tag.rec, name: "travel", means: "Trips", color: "blue" });
    const bad = await c.callTool({ name: "create_tag", arguments: { name: " ", description: "x" } });
    expect(bad.isError).toBe(true);
    await c.close();
  });

  it("creates a note, marked tainted, and reads it back", async () => {
    const c = await connect();
    const made = json(await c.callTool({ name: "create_note", arguments: { title: "From the laptop", body: "- one\n" } }));
    expect(made.saved).toMatch(/^notes\/.*\.md$/);
    const rec = [...pb.notes.values()].find((r) => r.path === made.saved);
    expect(rec?.tainted).toBe(true);
    const read = json(await c.callTool({ name: "read_note", arguments: { path: made.saved } }));
    expect(read.text).toContain("- one");
    await c.close();
  });

  it("a tool's refusal is an error result, and a bad input never reaches it", async () => {
    const c = await connect();
    const r = await c.callTool({ name: "read_note", arguments: { path: "secrets.txt" } });
    expect(r.isError).toBe(true);
    expect(json(r).error).toContain("Only notes");
    const bad = await c.callTool({ name: "search_notes", arguments: {} });
    expect(bad.isError).toBe(true);
    await c.close();
  });
});
