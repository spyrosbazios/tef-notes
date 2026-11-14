// Policy lives beside each tool factory. These small tables describe existing guard/approval behavior;
// they neither wrap execution nor replace the validators or the rev compare-and-swap.
import type { ModelMessage, ToolSet } from "ai";
import type { InferToolInput } from "@ai-sdk/provider-utils";
import type { Attached } from "@/core/assistant";
import type { Notes } from "./notes";
import type { Todo } from "./todo";

export type PolicyContext = { notes: Notes; todo: Todo; files: readonly Attached[] };
export type Policy<I = never> = {
  /** write follows the owner setting unless tainted; always ignores it; tainted is memory only. */
  approval: "none" | "write" | "always" | "tainted";
  /** records follows ids/paths with tainted provenance; untrusted taints even an error result. */
  result: "plain" | "records" | "untrusted";
  unavailableWhenTainted?: true;
  requiresExa?: true;
  check?: (context: PolicyContext, input: I) => string | null | Promise<string | null>;
};
export type PolicyLookup = (name: string) => Policy | undefined;
export type Policies<T extends ToolSet> = { [K in keyof T]: Policy<InferToolInput<T[K]>> };

type Options = { messages: ModelMessage[] };
type Input<P> = P extends { check: (c: PolicyContext, input: infer I) => unknown } ? I : unknown;
type Approvals<P> = {
  [K in keyof P as P[K] extends { approval: "none" } ? never : K]:
    (input: Input<P[K]>, ...options: P[K] extends { approval: "always" } ? [options?: Options] : [options: Options]) => Promise<"not-applicable" | "user-approval">;
};

/** Invalid calls go directly to execution's error; only valid calls can request a card. */
export function policyApprovals<P extends Record<string, Policy<any>>>(
  policies: P, context: PolicyContext, writesWithoutAsking: boolean,
  untrusted: (messages: ModelMessage[]) => Promise<boolean>,
): Approvals<P> {
  const out: Record<string, (input: unknown, options: Options) => Promise<"not-applicable" | "user-approval">> = {};
  for (const [name, policy] of Object.entries(policies)) {
    if (policy.approval === "none") continue;
    out[name] = async (input, { messages } = { messages: [] }) => {
      if (await policy.check?.(context, input)) return "not-applicable";
      const ask = policy.approval === "always"
        || (policy.approval === "tainted" ? await untrusted(messages) : !writesWithoutAsking || await untrusted(messages));
      return ask ? "user-approval" : "not-applicable";
    };
  }
  // Entries preserves the key/input pairing at runtime; the mapped type preserves it for callers.
  return out as Approvals<P>;
}
