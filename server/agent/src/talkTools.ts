// The chat's own tools, as Talk offers them (talk.ts): which of them a spoken conversation has, running one the way the
// chat would, and its result as the model is told it. There is no second declaration of a tool anywhere: the model is
// given the tools' own descriptions and schemas, and a call is run from the same object.
import { asSchema, type Tool, type ToolSet } from "ai";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import { SELECTION_TOOL_NAMES, uiToolsFor, UI_TOOL_NAMES, type AssistantContext } from "@/core/assistant";
import { policyFor } from "./tools";

/** What Talk leaves out of the chat's tools, and why: a drawing is a picture on a canvas the owner looks at and a spoken
 *  model cannot check (draw answers with one), the selection tools write into words the owner selected with the mouse (a
 *  spoken conversation has no selection bar), and attach_file files what the owner attached to a chat message (Talk has no
 *  messages to attach to). */
export const LEFT_OUT: ReadonlySet<string> = new Set(["draw", "save_drawing", "read_drawing", "show_drawing", "diagram_guide", ...SELECTION_TOOL_NAMES, "attach_file"]);

/** The tools Talk offers out of the chat's: not what it leaves out, not the web's without an Exa key, and the tools the app
 *  does itself only when the conversation began with a screen to do them on (uiToolsFor: no context, no app to answer). */
export function offered(all: ToolSet, web: boolean, page: AssistantContext | undefined): ToolSet {
  const ui = uiToolsFor(page), off = new Set<string>([...LEFT_OUT, ...UI_TOOL_NAMES.filter((n) => !ui.includes(n))]);
  return Object.fromEntries(Object.entries(all).filter(([name]) => !off.has(name) && (!policyFor(name as never)?.requiresExa || web)));
}

/** The same tools with nobody to run them: the agent loop would otherwise run a call itself, past the card and the
 *  taint rules Talk applies (talk.ts `handle`). It only ever asks for them. */
export const unrun = (tools: ToolSet): ToolSet =>
  Object.fromEntries(Object.entries(tools).map(([name, t]) => [name, { ...t, execute: undefined, needsApproval: undefined }]));

/** A call's input against the tool's own schema: the parsed input, or why not. */
export async function checked(t: Tool, input: unknown): Promise<{ input: unknown } | { error: string }> {
  const r = await asSchema(t.inputSchema).validate?.(input);
  return !r || r.success ? { input: r?.success ? r.value : input } : { error: r.error.message };
}

/** A tool's result as the model is told it: the tool's own `toModelOutput`, else the result as is (the AI SDK's rule). */
export async function modelOutput(t: Tool, toolCallId: string, input: unknown, output: unknown): Promise<ToolResultOutput> {
  if (t.toModelOutput) return t.toModelOutput({ toolCallId, input, output });
  return typeof output === "string" ? { type: "text", value: output } : { type: "json", value: output as never };
}

/** Runs a tool the way the chat would; a streaming tool's last result is its result. */
export async function run(t: Tool, input: unknown, call: { toolCallId: string; messages: never[]; abortSignal: AbortSignal }): Promise<unknown> {
  let output: unknown = await t.execute!(input, call as never);
  if (output && typeof output === "object" && Symbol.asyncIterator in output) for await (const x of output as AsyncIterable<unknown>) output = x;
  return output;
}
