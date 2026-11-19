// A note action's run (@/core/note-actions): a chat turn the owner started with a button on a note rather than a message.
// The request names the action and the note (`Run`); what the action is comes from the owner's preferences, never the
// request, and it narrows the turn: only the tools its `result` needs are offered, and a write to any other note, or a task
// not linked to this one, is refused before it can ask. Everything else is the chat's own: the cards, the owner's rules for
// each write (@/core/actions) and the taint checks.
import type { ModelMessage } from "ai";
import type { PromptAction, Result, Run } from "@/core/note-actions";

/** A run as the turn is built with it: the owner's action and the note it was pressed on. */
export type Scope = { action: PromptAction; note: string };

/** The action a request names, from the owner's list; undefined when it is gone (deleted on another device). */
export const scopeOf = (run: Run, actions: readonly PromptAction[]): Scope | undefined => {
  const action = actions.find((a) => a.id === run.id);
  return action && { action, note: run.note };
};

const READS = ["read_note", "search_notes", "list_notes", "list_tags", "read_attachment", "read_image", "read_drawing"] as const;

/** The tools a run is offered, by what it ends in. No web, no memory, none of the app's own tools: a button has no chat to
 *  wander in, and nobody to answer a question. */
const OFFERED: Record<Result, readonly string[]> = {
  edit: [...READS, "rewrite_note", "append_to_note"],
  task: [...READS, "list_tasks", "list_tagged", "find_place", "add_task", "set_place"],
  answer: [...READS, "list_tasks", "list_tagged"],
};

/** Whether a run may be offered `tool`. */
export const offeredTo = (scope: Scope, tool: string): boolean => OFFERED[scope.action.result].includes(tool);

const DOES: Record<Result, string> = {
  edit: "Then make the change with one rewrite_note call on that note and no other, sending its whole new body; the owner is shown it as a diff to accept. After it, reply with one short sentence saying what changed. If the note needs no change, say so and write nothing.",
  task: "Then propose one task with add_task, with that note's path in `link`; the owner is shown it as a card to accept. Give it a place (find_place, then set_place) only if the note names one. After it, reply with one short sentence.",
  answer: "Then reply with the answer itself, briefly, in the note's language. Change nothing.",
};

/** What a run adds to the agent's instructions. */
export const instructions = ({ action, note }: Scope): string =>
  `This turn is a note action, not a conversation: the owner pressed the button “${action.label}” on ${note}, and their message is the prompt saved for that button. Nobody is there to answer a question, so decide and act. Read the note first with read_note. ${DOES[action.result]}`;

type Status = "not-applicable" | "user-approval" | { type: "denied"; reason: string };
type Check = (input: unknown, options: { messages: ModelMessage[] }) => Promise<Status>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const field = (input: unknown, key: string): unknown => (input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined);

/** Why a run may not make this call, or null: a note write is for its own note, and a new task links to it. */
export function outOfScope({ note }: Scope, tool: string, input: unknown): string | null {
  if ((tool === "rewrite_note" || tool === "append_to_note") && str(field(input, "path")) !== note) return `This action changes ${note} and no other note.`;
  const link = field(input, "link");
  if (tool === "add_task" && !(Array.isArray(link) && link.includes(note))) return `Link the task to the note it comes from: pass ${note} in \`link\`.`;
  return null;
}

/** The chat's approvals, narrowed to a run: a call out of its scope is refused with the reason, any other asks as it would. */
export function scoped<A extends Record<string, unknown>>(approvals: A, scope: Scope): A {
  const all = approvals as Record<string, Check | undefined>, out: Record<string, Check> = {};
  for (const [tool, check] of Object.entries(all)) {
    if (!check) continue;
    out[tool] = async (input, options) => {
      const bad = outOfScope(scope, tool, input);
      return bad ? { type: "denied", reason: bad } : check(input, options);
    };
  }
  return out as A;
}
