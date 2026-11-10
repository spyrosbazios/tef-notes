// The AI SDK's message parts as the Ask view reads them. The wording (tool labels, step summaries, write flags) is the
// core's (@/core/agent), shared with the phone.
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export type Part = UIMessage["parts"][number];
export type ToolPart = Extract<Part, { type: `tool-${string}` | "dynamic-tool" }>;

export const toolName = (p: ToolPart) => getToolName(p);
export const isTool = (p: Part): p is ToolPart => isToolUIPart(p);

const shown = (p: Part) => p.type === "reasoning" || isTool(p) || (p.type === "text" && !!p.text);
const settled = (p: Part) => isTool(p) && (p.state === "output-available" || p.state === "output-error" || p.state === "output-denied");

/** A reply is on its way but nothing on screen is moving yet: no reply, or the last thing shown is a finished tool call
 *  (the dock's and an ask's "Thinking…" line). */
export function waiting(last: UIMessage | undefined, busy: boolean): boolean {
  const tail = last?.role === "assistant" ? last.parts.filter(shown).at(-1) : undefined;
  return busy && (!tail || settled(tail));
}

/** A confirm card waits for the owner's answer on the last message. */
export const asking = (last: UIMessage | undefined) =>
  last?.role === "assistant" && last.parts.some((p) => isTool(p) && p.state === "approval-requested");
