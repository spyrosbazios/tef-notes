// POST /agent/find { q }: search by asking (contract: packages/core/src/find.ts). A short loop on the default model with
// only the read tools over notes and tasks; it ends by calling `answer` with the hits. No chat is made or saved and
// nothing is written; no web tools, so nothing it sees is untrusted. A path or id the model made up is dropped here.
import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { z } from "zod";
import { FOUND_MAX, type Found } from "@/core/find";
import type { Server } from "@/core/pocketbase";
import { DEFAULT, model, Unavailable } from "./models";
import { Notes } from "./notes";
import { today } from "./systemPrompt";
import { Todo } from "./todo";
import { tools } from "./tools";

const STEPS = 6;

const Body = z.object({ q: z.string().trim().min(1).max(500) });

const INSTRUCTIONS = `You find things in the user's notes and tasks for a search box that came up empty. The query is in their own words: a description, a question, half a memory. Search with search_notes (try a few phrasings, other languages, synonyms) and list_tasks (view "all", short queries); read_note when a snippet isn't enough to be sure. Then call answer once with only what really fits, best first, at most ${FOUND_MAX} notes and ${FOUND_MAX} tasks, each with a short reason in the query's language. Nothing fits: answer with empty lists. Never make up a path or id: only those the tools returned.`;

const Hits = z.object({
  notes: z.array(z.object({ path: z.string(), why: z.string().max(140) })).max(FOUND_MAX),
  tasks: z.array(z.object({ id: z.string(), why: z.string().max(140) })).max(FOUND_MAX),
});
const answer = tool({ description: "The hits, best first. Ends the search.", inputSchema: Hits });

const fail = (status: number, message: string) => Response.json({ message }, { status });

/** `pick`: the model; the tests hand in a mock. */
export async function find(req: Request, server: Server, pick: typeof model = model): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Bad request: q");
  const notes = new Notes(server), todo = new Todo(server), all = tools(notes, todo);
  let m: Awaited<ReturnType<typeof model>>;
  try { m = await pick(DEFAULT); } catch (e) {
    if (e instanceof Unavailable) return fail(400, e.message);
    throw e;
  }
  const result = await generateText({
    model: m.model,
    providerOptions: m.providerOptions,
    instructions: `${INSTRUCTIONS}\n${today()}`,
    prompt: parsed.data.q,
    tools: { search_notes: all.search_notes, read_note: all.read_note, list_tasks: all.list_tasks, answer },
    reasoning: "minimal",
    stopWhen: [hasToolCall("answer"), isStepCount(STEPS)],
    // the last step must answer, or the loop ends with nothing to show
    prepareStep: ({ stepNumber }) => (stepNumber === STEPS - 1 ? { toolChoice: { type: "tool" as const, toolName: "answer" as const } } : {}),
    abortSignal: req.signal,
  });
  const call = result.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === "answer");
  const said = Hits.safeParse(call?.input).data ?? { notes: [], tasks: [] };
  const known = new Set((await notes.list()).map((n) => n.path)), ids = new Set((await todo.tasks()).map((t) => t.id));
  const found: Found = {
    notes: said.notes.filter((h) => known.has(h.path) && h.path.startsWith("notes/")),
    tasks: said.tasks.filter((h) => ids.has(h.id)),
  };
  return Response.json(found);
}
