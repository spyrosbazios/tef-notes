// Policy lives beside each tool factory: a tool module (`toolModule`) is its tools and a policy for every one of them, and
// tools.ts registers the modules. These small tables describe guard/approval behavior and where a tool is offered; they
// neither wrap execution nor replace the validators or the rev compare-and-swap. A write's card is the owner's rule for its
// action (@/core/actions), read from their preferences for every turn: the one path every write's approval takes.
import type { ModelMessage, ToolSet } from "ai";
import type { InferToolInput } from "@ai-sdk/provider-utils";
import { decide, refused, type Action, type Actions } from "@/core/actions";
import type { Attached } from "@/core/assistant";
import { RESULTS, type Result } from "@/core/note-actions";
import type { NoteService } from "./application/notes";
import type { TaskService } from "./application/todo";

/** What a module's tools are built over, for one request: its view of the notes and tasks; `fromPage`, whether a write is
 *  marked `tainted` (web text in view); `files`, what the owner attached in the chat (attach_file). */
export type ToolDeps = {
  notes: NoteService; todo: TaskService; fromPage: (messages: ModelMessage[]) => Promise<boolean>; files: readonly Attached[];
};
export type PolicyContext = Pick<ToolDeps, "notes" | "todo" | "files">;

/** A note action's run of any kind (@/core/note-actions): what the reads are offered to. */
export const EVERY_RUN = RESULTS;

export type Policy<I = never> = {
  /** none: reads and the client's own edits, never a card. An action: the owner's rule for it decides (decide, @/core/actions). */
  approval: "none" | Action;
  /** records follows ids/paths with tainted provenance; untrusted taints even an error result; marked taints when `taints` says
   *  this result carries text that isn't the owner's (a tool that lists text of mixed provenance). */
  result: "plain" | "records" | "untrusted" | "marked";
  /** For `marked`: whether a result (what `execute` returned) carries someone else's text. */
  taints?: (output: unknown) => boolean;
  unavailableWhenTainted?: true;
  requiresExa?: true;
  /** Left out of Talk, the spoken conversation (turn.ts): it needs what Talk hasn't, a selection made
   *  with the mouse, or a file attached to a chat message. */
  unavailableInTalk?: true;
  /** Offered to a note action's run whose action ends in one of `results` (note-action.ts); absent, never. `scope`: why a call
   *  falls outside the run on `note` (refused before it can ask), or null. */
  run?: { results: readonly Result[]; scope?: (note: string, input: I) => string | null };
  check?: (context: PolicyContext, input: I) => string | null | Promise<string | null>;
};
export type PolicyLookup = (name: string) => Policy | undefined;
export type Policies<T extends ToolSet> = { [K in keyof T]: Policy<InferToolInput<T[K]>> };

/** A tool module: its tools for a request, and a policy for each of them. A tool without one, or a policy without its tool,
 *  doesn't compile. */
export type ToolModule<T extends ToolSet> = { tools: (deps: ToolDeps) => T; policies: Policies<T> };
export const toolModule = <T extends ToolSet>(tools: (deps: ToolDeps) => T, policies: NoInfer<Policies<T>>): ToolModule<T> => ({ tools, policies });

type Options = { messages: ModelMessage[] };
type Status = "not-applicable" | "user-approval" | { type: "denied"; reason: string };
type Input<P> = P extends { check: (c: PolicyContext, input: infer I) => unknown } ? I : unknown;
type Approvals<P> = {
  [K in keyof P as P[K] extends { approval: "none" } ? never : K]: (input: Input<P[K]>, options: Options) => Promise<Status>;
};

/** Whether the owner allows the tool at all: a tool whose action is "never" is withdrawn from the model. */
export const allowed = (policy: Policy | undefined, rules: Actions) => !policy || policy.approval === "none" || rules[policy.approval] !== "never";

/** A "never" action is refused before anything else; then a call its check fails is refused with the check's reason (the model
 *  reads it; no card is shown), and a valid one asks when its rule is "ask", or "auto" in a tainted turn. A failed check is never
 *  waved through to `execute`: the SDK decides every call of a step before it runs any, so one that fails now (a note the call
 *  beside it is about to create) could pass by the time it runs, with no card. */
export function policyApprovals<P extends Record<string, Policy<any>>>(
  policies: P, context: PolicyContext, rules: Actions,
  untrusted: (messages: ModelMessage[]) => Promise<boolean>,
): Approvals<P> {
  const out: Record<string, (input: unknown, options: Options) => Promise<Status>> = {};
  for (const [name, policy] of Object.entries(policies)) {
    if (policy.approval === "none") continue;
    const action = policy.approval, rule = rules[action];
    out[name] = async (input, { messages }) => {
      if (rule === "never") return { type: "denied", reason: refused(action) };
      const bad = await policy.check?.(context, input);
      if (bad) return { type: "denied", reason: bad };
      // "ask" never reads the history: nothing a turn holds can turn its card off
      return decide(rule, rule === "auto" && await untrusted(messages)) === "ask" ? "user-approval" : "not-applicable";
    };
  }
  // Entries preserves the key/input pairing at runtime; the mapped type preserves it for callers.
  return out as Approvals<P>;
}
