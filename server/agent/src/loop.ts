// What the agent loop changes between steps (prepareStep): earlier turns' bulky tool results trimmed, and the tools a
// step is offered.
import type { ModelMessage, ToolResultPart } from "ai";
import { SELECTION_TOOL_NAMES } from "@/core/assistant";

/** A tool result from an earlier turn longer than this (as JSON) is replaced by a line saying so. */
export const TRIM_OVER = 2000;

/** The history with every bulky tool result from before the newest user message cut to a stub: a page, a PDF, a
 *  picture, a long search is read for the answer it served, and then rides along every later request. The model calls
 *  the tool again if it needs it. This turn's results stay whole: it is still working with them. Done once, on the
 *  turn's first step, so the prefix stays the same from step to step (and turn to turn) for the prompt cache. */
export function trim(ms: ModelMessage[]): ModelMessage[] {
  const cut = ms.findLastIndex((m) => m.role === "user");
  if (cut <= 0) return ms;
  return ms.map((m, i) => (i >= cut || m.role !== "tool" ? m : { ...m, content: m.content.map((p) => (p.type === "tool-result" ? stub(p) : p)) }));
}

function stub(p: ToolResultPart): ToolResultPart {
  if (p.output.type === "execution-denied" || p.output.type.startsWith("error")) return p;
  const size = JSON.stringify(p.output).length;
  return size <= TRIM_OVER ? p : {
    ...p,
    output: { type: "text", value: `(Trimmed: ${p.toolName}'s result from an earlier turn, ${size} characters. Call it again if you need it.)` },
  };
}

/** Never offered once the turn has read someone else's text: memory rides on every later chat, the place a page's
 *  instructions would last longest; the selection tools write into a note with no card (core/assistant.ts "the
 *  selection"), so a page's instructions would too. The note tools stay, and ask. */
export const NOT_WHEN_TAINTED = new Set(["update_memory", ...SELECTION_TOOL_NAMES, "save_drawing"]);

/** The tools one step is offered: `base` (the request's), less the ones a tainted turn loses. */
export const stepTools = <T extends string>(base: readonly T[], tainted: boolean): T[] =>
  tainted ? base.filter((n) => !NOT_WHEN_TAINTED.has(n)) : [...base];
