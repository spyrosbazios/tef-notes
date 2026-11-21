// The agent's pure parts, no I/O, so test/guard.test.ts can hold them: history repair, the web-taint check, caps.
import type { PolicyLookup } from "./tool-policy";
import { getToolName, isToolUIPart, safeValidateUIMessages, type ModelMessage, type ToolSet, type UIMessage } from "ai";
import { UNCONFIRMED } from "@/core/agent";
import { isAskTool, isUiTool } from "@/core/assistant";

type Part = UIMessage["parts"][number];

const open = (p: Part) => isToolUIPart(p) && (p.state === "input-streaming" || p.state === "input-available");
/** A confirm card, asked or answered, still waiting on the resend that runs it. */
const awaiting = (p: Part) => isToolUIPart(p) && (p.state === "approval-requested" || p.state === "approval-responded");

const lastUser = (ms: UIMessage[]) => { let i = ms.length - 1; while (i >= 0 && ms[i].role !== "user") i--; return i; };

/** A turn stopped mid-tool leaves a call with no result, and the SDK refuses to send that history again (a call to a tool
 *  the client does itself too: the app never answered it). Close each such call as failed; one still streaming its input never reached the model, so it goes. A confirm
 *  card before the newest user message was never answered, or answered with nothing resent: no write ran, so
 *  it's denied. The newest turn's card is still live and stays. */
export function settle<M extends UIMessage>(ms: M[], ended = false): M[] {
  const last = lastUser(ms);
  const stale = (p: Part, i: number) => open(p) || ((ended || i < last) && awaiting(p));
  if (!ms.some((m, i) => m.parts.some((p) => stale(p, i)))) return ms;
  return ms.map((m, i) => (!m.parts.some((p) => stale(p, i)) ? m : {
    ...m,
    parts: m.parts.flatMap((p) => {
      if (!isToolUIPart(p) || !stale(p, i)) return [p];
      if (p.state === "input-streaming") return [];
      if (p.state === "input-available") return [{ ...p, state: "output-error", errorText: isAskTool(getToolName(p)) ? "The owner didn't answer." : isUiTool(getToolName(p)) ? "The app didn't do it." : "Stopped before it finished." }];
      if (p.state !== "approval-requested" && p.state !== "approval-responded") return [p];
      const reason = p.state === "approval-responded" && !p.approval.approved ? p.approval.reason : UNCONFIRMED;   // a "no" keeps its own
      return [{ ...p, state: "output-denied", approval: { ...p.approval, approved: false, reason } }];
    }),
  } as M));
}

/** The newest user message with `context` as a text part ahead of its own: what changes between messages rides
 *  there, so the instructions stay one fixed prefix for the prompt cache. A copy: the chat as saved never holds it. */
export function withContext<M extends UIMessage>(ms: M[], context: string): M[] {
  const last = lastUser(ms);
  return last < 0 ? ms : ms.map((m, i) => (i !== last ? m : { ...m, parts: [{ type: "text", text: context }, ...m.parts] } as M));
}

/** A saved chat against today's tools: a call whose input no longer fits its tool's schema (or whose tool is gone
 *  before it finished) makes the SDK refuse the whole history. Execution copy only: never persist this projection. */
export async function repair<M extends UIMessage>(ms: M[], tools: ToolSet): Promise<M[]> {
  const ok = async (x: UIMessage[]) => (await safeValidateUIMessages({ messages: x, tools })).success;
  if (await ok(ms)) return ms;
  return Promise.all(ms.map(async (m) => (await ok([m]) ? m : {
    ...m,
    parts: await Promise.all(m.parts.map(async (p) => (!isToolUIPart(p) || (await ok([{ ...m, parts: [p] }])) ? p
      : { type: "text" as const, text: `(An earlier ${getToolName(p)} call, from an older version of the app, left out.)` }))),
  } as M)));
}

/** Whether the model has read web text (or a PDF's) this turn or earlier: a page can carry instructions aimed at it. `tainted`:
 *  the paths of notes and ids of tasks written in a chat that had (their `tainted` column); one read back
 *  here is web text too, a chat later. */
export const fromWeb = (ms: ModelMessage[], tainted: ReadonlySet<string>, policyFor: PolicyLookup) =>
  ms.some((m) => m.role === "tool" && m.content.some((p) => {
    if (p.type !== "tool-result") return false;
    const policy = policyFor(p.toolName);
    return policy?.result === "untrusted"
      || (policy?.result === "records" && tainted.size > 0 && names(p.output, tainted))
      || (policy?.result === "marked" && !!policy.taints?.(p.output.type === "json" ? p.output.value : undefined));
  }));

/** Whether a tool result names one of these paths or ids: as a JSON string value, so one quoted inside a note's text doesn't count. */
function names(output: unknown, paths: ReadonlySet<string>) {
  const s = JSON.stringify(output) ?? "";
  for (const p of paths) if (s.includes(JSON.stringify(p))) return true;
  return false;
}

/** Text for the model, cut at n chars. */
export const clip = (text: string, n: number) => (text.length > n ? { text: text.slice(0, n), truncated: true, chars: text.length } : { text });

/** At most n of a list for the model, and how many were left out: the newest of a dated list (`end`), else the top. */
export const capList = <T,>(xs: T[], n: number, end = false) =>
  xs.length <= n ? { list: xs } : { list: end ? xs.slice(-n) : xs.slice(0, n), left_out: xs.length - n };

/** Read provenance from the intact UI history, before obsolete tool inputs are repaired away. A result and an error both count
 *  (an untrusted tool's error text can carry the page's words, as `fromWeb` has it); a call with neither yet read nothing. */
export function historyFromWeb(ms: UIMessage[], tainted: ReadonlySet<string>, policyFor: PolicyLookup) {
  return ms.some((m) => m.parts.some((p) => {
    if (!isToolUIPart(p) || (p.state !== "output-available" && p.state !== "output-error")) return false;
    const policy = policyFor(getToolName(p));
    // A removed tool with an opaque result has no trustworthy provenance classification.
    return !policy || policy.result === "untrusted"
      || (p.state === "output-available" && ((policy.result === "records" && names(p.output, tainted)) || (policy.result === "marked" && !!policy.taints?.(p.output))));
  }));
}
