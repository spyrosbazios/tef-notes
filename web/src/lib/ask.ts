// The AI SDK's message parts as the Ask view reads them. The wording (tool labels, step summaries, write flags) is the
// core's (@/core/agent), shared with the phone.
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export type Part = UIMessage["parts"][number];
export type ToolPart = Extract<Part, { type: `tool-${string}` | "dynamic-tool" }>;

export const toolName = (p: ToolPart) => getToolName(p);
export const isTool = (p: Part): p is ToolPart => isToolUIPart(p);
