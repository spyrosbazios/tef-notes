// The agent's write actions and what the owner allows of each: the one definition of which actions need their approval.
// Every agent tool that writes belongs to one action (its policy's `approval`, server/agent/src/tool-policy.ts); the owner sets
// a Rule per action in Settings (prefs.ts `actions`), and the agent's server reads it for every turn and enforces it, so a model
// cannot skip a card:
//   - "ask": a confirm card every time.
//   - "auto": done without a card, unless the turn has read the web, a PDF or someone else's text (tainted): then it asks.
//   - "never": the tool is withdrawn from the model, and a call made anyway is refused.
// The defaults are what the agent always did before this was a setting: notes and tasks ask, its memory doesn't.
// Not here: the edits the web's editor makes itself (`replace_selection`, `insert_after_selection`, `draw`, `save_drawing`):
// the owner's own undoable edits, saved by them. Pure and platform-neutral.

export const ACTIONS = [
  "createTask", "editTask", "deleteTask", "createNote", "editNote", "deleteNote", "files", "tags", "noteActions", "memory",
] as const;
export type Action = (typeof ACTIONS)[number];

export const RULES = ["ask", "auto", "never"] as const;
type Rule = (typeof RULES)[number];
export const RULE_LABEL: Record<Rule, string> = { ask: "Ask first", auto: "Just do it", never: "Never" };

/** What Settings shows of each action: its name, and the writes it covers. */
export const ACTION_LABEL: Record<Action, { name: string; covers: string }> = {
  createTask: { name: "Create tasks", covers: "New tasks, one or several" },
  editTask: { name: "Change tasks", covers: "Edit, reschedule, tick, set a place, link to notes" },
  deleteTask: { name: "Delete tasks", covers: "Remove a task" },
  createNote: { name: "Create notes", covers: "A new note" },
  editNote: { name: "Edit notes", covers: "Append, rewrite, summarise links, pin or archive" },
  deleteNote: { name: "Delete notes", covers: "Remove a note and its files" },
  files: { name: "Files", covers: "Attach a chat's photo or PDF to a note" },
  tags: { name: "Tags and lenses", covers: "Create and describe tags, create lenses" },
  noteActions: { name: "Note actions", covers: "Add or change the assistant buttons a note offers" },
  memory: { name: "Memory", covers: "What it remembers about you" },
};

export type Actions = Record<Action, Rule>;

export const DEFAULT_ACTIONS: Actions = {
  createTask: "ask", editTask: "ask", deleteTask: "ask", createNote: "ask", editNote: "ask", deleteNote: "ask",
  files: "ask", tags: "ask", noteActions: "ask", memory: "auto",
};

export const isAction = (v: unknown): v is Action => (ACTIONS as readonly unknown[]).includes(v);
const ruleOf = (v: unknown, fallback: Rule): Rule => RULES.find((r) => r === v) ?? fallback;

/** Whatever was stored: an unknown or missing action is its default. */
export function actionsOf(raw: unknown): Actions {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return Object.fromEntries(ACTIONS.map((k) => [k, ruleOf(a[k], DEFAULT_ACTIONS[k])])) as Actions;
}

/** What a call needs: `tainted`, whether the turn holds someone else's text. */
export function decide(rule: Rule, tainted: boolean): "ask" | "go" | "refuse" {
  if (rule === "never") return "refuse";
  return rule === "ask" || tainted ? "ask" : "go";
}

/** The refusal a "never" call gets back. */
export const refused = (a: Action) => `Not allowed: the owner turned off "${ACTION_LABEL[a].name}" for the assistant (Settings).`;
