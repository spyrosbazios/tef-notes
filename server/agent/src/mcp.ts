// POST /agent/mcp: the agent's note and task tools as an MCP server (Streamable HTTP, stateless, JSON replies), so
// another agent harness (Claude Code, Codex, Cursor …) can work on the notes with its own model. Off unless
// TEF_NOTES_MCP=1 (index.ts). The same tools the chat uses (tools.ts), so a write is the same rev compare-and-swap;
// what differs:
// - no confirm cards: the harness's own approval prompt stands in for them (each tool says whether it writes);
// - every write is marked `tainted`: whatever the harness had in view is unknown, so the in-app assistant treats
//   what it wrote as web text and asks before writing once it has read it (guard.ts);
// - none of the chat's own tools: web search (the harness has its own), memory, preview cards, the app's UI tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import type { Server } from "@/core/pocketbase";
import { localDay } from "@/core/time";
import { Notes } from "./notes";
import { Todo } from "./todo";
import { tools, type Tools } from "./tools";

const READS = ["list_tags", "search_notes", "list_notes", "read_note", "read_attachment", "list_tasks"] as const;
const WRITES = ["create_tag", "update_tag", "create_note", "append_to_note", "rewrite_note", "summarise_links", "set_note_flags", "add_task", "add_tasks", "update_task", "complete_task"] as const;
const DELETES = ["delete_note", "delete_task"] as const;
/** What the endpoint offers, of the chat's tools. */
export const MCP_TOOLS: readonly (keyof Tools)[] = [...READS, ...WRITES, ...DELETES];

const INSTRUCTIONS = (today: string) => `TEF Notes: the user's own notes (markdown, paths notes/<file>.md) and tasks (Things-style: inbox, today, upcoming, logbook). Today is ${today}.
Find before you write: search_notes, list_notes, list_tasks. Add to a note that fits (append_to_note) before creating one. Write in the user's words and language. Tags only from list_tags; create_tag or update_tag to manage definitions when asked.
The tools' descriptions mention a confirm card: here your own harness's approval is that card. Every write is checked against the version it was based on, and a note changed meanwhile is merged or refused: re-read and redo, never retry blindly.`;

type Exec = (input: unknown, o: { toolCallId: string; messages: []; abortSignal?: AbortSignal }) => Promise<unknown>;

/** A fresh server for one request: the tools read the notes as they are now. */
export function mcpServer(server: Server) {
  const notes = new Notes(server), todo = new Todo(server);
  const all = tools(notes, todo, async () => true);
  const s = new McpServer({ name: "tefnotes", version: "1.0.0" }, { instructions: INSTRUCTIONS(localDay()) });
  for (const name of MCP_TOOLS) {
    const t = all[name], read = (READS as readonly string[]).includes(name);
    s.registerTool(name, {
      description: t.description as string,   // every one of ours is a plain string
      inputSchema: t.inputSchema as z.ZodObject,
      annotations: { readOnlyHint: read, destructiveHint: (DELETES as readonly string[]).includes(name) || name === "rewrite_note", openWorldHint: false },
    }, async (args, extra) => {
      const out = await (t.execute as unknown as Exec)(args, { toolCallId: String(extra.requestId), messages: [], abortSignal: extra.signal });
      const failed = !!out && typeof out === "object" && "error" in out;
      return { content: [{ type: "text" as const, text: JSON.stringify(out) }], ...(failed ? { isError: true } : {}) };
    });
  }
  return s;
}

/** One MCP request: stateless, so no session to keep between them. */
export async function mcp(req: Request, server: Server): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcpServer(server).connect(transport);
  return transport.handleRequest(req);
}
