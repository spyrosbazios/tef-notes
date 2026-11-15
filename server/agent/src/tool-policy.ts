// Policy lives beside each tool factory. These small tables describe guard/approval behavior; they neither wrap execution nor
// replace the validators or the rev compare-and-swap. A write's card is the owner's rule for its action (@/core/actions), read
// from their preferences for every turn: the one path every write's approval takes.
import type { ModelMessage, ToolSet } from "ai";
import type { InferToolInput } from "@ai-sdk/provider-utils";
import { decide, refused, type Action, type Actions } from "@/core/actions";
import type { Attached } from "@/core/assistant";
import type { Notes } from "./notes";
import type { Todo } from "./todo";

export type PolicyContext = { notes: Notes; todo: Todo; files: readonly Attached[] };
export type Policy<I = never> = {
  /** none: reads and the client's own edits, never a card. An action: the owner's rule for it decides (decide, @/core/actions). */
  approval: "none" | Action;
  /** records follows ids/paths with tainted provenance; untrusted taints even an error result. */
  result: "plain" | "records" | "untrusted";
  unavailableWhenTainted?: true;
  requiresExa?: true;
  check?: (context: PolicyContext, input: I) => string | null | Promise<string | null>;
};
export type PolicyLookup = (name: string) => Policy | undefined;
export type Policies<T extends ToolSet> = { [K in keyof T]: Policy<InferToolInput<T[K]>> };

type Options = { messages: ModelMessage[] };
type Status = "not-applicable" | "user-approval" | { type: "denied"; reason: string };
type Input<P> = P extends { check: (c: PolicyContext, input: infer I) => unknown } ? I : unknown;
type Approvals<P> = {
  [K in keyof P as P[K] extends { approval: "none" } ? never : K]: (input: Input<P[K]>, options: Options) => Promise<Status>;
};

/** Whether the owner allows the tool at all: a tool whose action is "never" is withdrawn from the model. */
export const allowed = (policy: Policy | undefined, rules: Actions) => !policy || policy.approval === "none" || rules[policy.approval] !== "never";

/** A "never" action is refused before anything else; otherwise an invalid call goes directly to execution's error (only valid
 *  calls can request a card), and a valid one asks when its rule is "ask", or "auto" in a tainted turn. */
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
      if (await policy.check?.(context, input)) return "not-applicable";
      // "ask" never reads the history: nothing a turn holds can turn its card off
      return decide(rule, rule === "auto" && await untrusted(messages)) === "ask" ? "user-approval" : "not-applicable";
    };
  }
  // Entries preserves the key/input pairing at runtime; the mapped type preserves it for callers.
  return out as Approvals<P>;
}
