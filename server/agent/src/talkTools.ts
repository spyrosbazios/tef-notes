// The chat's own tools, as the speech model gets them (talk.ts): which of them Talk offers, their declarations made from each tool's
// own description and input schema (never a second hand-written copy), running one, and its result in the shape Gemini takes.
import { asSchema, type ModelMessage, type Tool, type ToolSet } from "ai";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import { Behavior, type FunctionDeclaration, type FunctionResponse, type FunctionResponsePart } from "@google/genai";
import { SELECTION_TOOL_NAMES, uiToolsFor, UI_TOOL_NAMES, type AssistantContext } from "@/core/assistant";
import { WEB_TOOLS } from "./guard";

/** What Talk leaves out of the chat's tools, and why: a drawing is a picture on a canvas the owner looks at and the speech model
 *  cannot check (draw answers with one), the selection tools write into words the owner selected with the mouse (a spoken
 *  conversation has no selection bar), and attach_file files what the owner attached to a chat message (Talk has no messages
 *  to attach to). */
export const LEFT_OUT: ReadonlySet<string> = new Set(["draw", "save_drawing", "read_drawing", "show_drawing", "diagram_guide", ...SELECTION_TOOL_NAMES, "attach_file"]);

/** The tools Talk offers out of the chat's: not what it leaves out, not the web's without an Exa key, and the tools the app does
 *  itself only when the conversation began with a screen to do them on (uiToolsFor: no context, no app to answer). */
export function offered(all: ToolSet, web: boolean, page: AssistantContext | undefined): ToolSet {
  const ui = uiToolsFor(page), off = new Set<string>([...LEFT_OUT, ...(web ? [] : WEB_TOOLS), ...UI_TOOL_NAMES.filter((n) => !ui.includes(n))]);
  return Object.fromEntries(Object.entries(all).filter(([name]) => !off.has(name)));
}

/** One declaration per tool. NON_BLOCKING, so the model goes on talking while a tool runs (a search, or a confirm card
 *  waiting for the owner's tap) and says what it found when the answer comes; the owner can interrupt at any time. */
export const declarations = (tools: ToolSet): FunctionDeclaration[] => Object.entries(tools).map(([name, t]) => ({
  name,
  description: typeof t.description === "function" ? t.description({ context: undefined }) : t.description,
  behavior: Behavior.NON_BLOCKING,
  parametersJsonSchema: Object.fromEntries(Object.entries(asSchema(t.inputSchema).jsonSchema as Record<string, unknown>).filter(([k]) => k !== "$schema")),
}));

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
export async function run(t: Tool, input: unknown, call: { toolCallId: string; messages: ModelMessage[]; abortSignal: AbortSignal }): Promise<unknown> {
  let output: unknown = await t.execute!(input, call as never);
  if (output && typeof output === "object" && Symbol.asyncIterator in output) for await (const x of output as AsyncIterable<unknown>) output = x;
  return output;
}

/** What a tool answered, as a Gemini function response. Never empty: a status says what happened, so the model does not call
 *  again to find out (docs: "Developer's guide to Gemini 3.8 Live"). `history`: the same as the conversation keeps it (the
 *  taint check reads it), with a picture's bytes left out. */
export type Answer = { response: NonNullable<FunctionResponse["response"]>; parts?: FunctionResponsePart[]; history: ToolResultOutput };

export const failed = (message: string, retryable = false): Answer => ({
  response: { status: "error", retryable, error: message }, history: { type: "error-text", value: message },
});

const PICTURES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function answerOf(out: ToolResultOutput): Answer {
  switch (out.type) {
    case "text": return { response: { status: "ok", output: out.value }, history: out };
    case "json": {
      const error = (out.value as { error?: unknown } | null)?.error;      // the tools answer a failure as { error }
      return typeof error === "string" ? failed(error) : { response: { status: "ok", output: out.value }, history: out };
    }
    case "error-text": return failed(out.value);
    case "error-json": return failed(JSON.stringify(out.value));
    case "execution-denied": {
      const message = out.reason ?? "The owner declined.";
      return { response: { status: "denied", retryable: false, message }, history: out };
    }
    case "content": {
      const text = out.value.flatMap((p) => (p.type === "text" ? [p.text] : []));
      const parts = out.value.flatMap((p): FunctionResponsePart[] => (p.type === "file" && p.data.type === "data" && PICTURES.has(p.mediaType) && typeof p.data.data === "string"
        ? [{ inlineData: { data: p.data.data, mimeType: p.mediaType } }] : []));
      return { response: { status: "ok", output: text.join("\n") || "(attached)" }, ...(parts.length && { parts }), history: { type: "text", value: text.join("\n") } };
    }
  }
}
