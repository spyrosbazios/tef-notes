// GET /agent/search?q=&limit=: the notes by their words and meaning, no model loop and nothing written: the same
// search the chat's `search_notes` runs (notes.ts, semantic.ts). Contract: packages/core/src/find.ts `SearchHit`; the
// CLI's `tefnotes search`.
import { SEARCH_MAX, type SearchHit } from "@/core/find";
import type { Server } from "@/core/pocketbase";
import { Notes } from "./notes";

export async function search(req: Request, server: Server): Promise<Response> {
  const u = new URL(req.url), q = (u.searchParams.get("q") ?? "").trim(), limit = Number(u.searchParams.get("limit") ?? 10);
  if (!q || q.length > 500) return Response.json({ message: "Bad request: q" }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX) return Response.json({ message: `Bad request: limit is 1 to ${SEARCH_MAX}` }, { status: 400 });
  const results: SearchHit[] = await new Notes(server).search(q, limit);
  return Response.json({ results });
}
