// A note's actions: what the note screen's header offers, and where each sits. Two kinds share one list:
//   - built-ins, done by the app itself (`BUILTINS`: attach, pin, ask, the markdown source, copy the link, download, archive);
//   - assistant actions, the owner's saved prompts (`PromptAction`, kept in prefs `noteActions`): a button that has the agent
//     run the prompt on the open note, with no chat to open. Tidy and Make a task are two that come with the app, the owner's
//     to change or delete like any they wrote.
// Where an action sits is a layout's own (prefs `phone.noteHeader`, `desktop.noteHeader`): a `Slot` each, in order, a button in
// the header, a row in its menu, or off. A header holds `HEADER_MAX` buttons; Delete and the colour are the menu's, always.
// A run (`runMessage`, `ActionRun`): the client sends the message naming the note and the prompt as a chat of its own, with the
// action's id beside it; the agent's server reads the action from the preferences and offers only the tools its `result`
// needs (server/agent/src/note-action.ts), so a summary can't delete and a tidy can't touch another note. Its writes are the
// chat's: the same cards, the owner's rules (actions.ts) and the taint checks.
// Pure and platform-neutral.
import type { NoteRef } from "./handoff";
import { noteIdOf } from "./notes";

// ---- the actions

/** The actions the app does itself. */
export const BUILTINS = ["attach", "pin", "ask", "source", "copyLink", "download", "archive"] as const;
export type Builtin = (typeof BUILTINS)[number];
export const BUILTIN_LABEL: Record<Builtin, string> = {
  attach: "Attach or draw", pin: "Pin to top", ask: "Ask about this note", source: "Markdown source", copyLink: "Copy link",
  download: "Download .md", archive: "Archive",
};
export const isBuiltin = (v: unknown): v is Builtin => (BUILTINS as readonly unknown[]).includes(v);

/** What a prompt's run ends in, which is also all it may do: rewrite this note, make a task of it, or only answer. */
export const RESULTS = ["edit", "task", "answer"] as const;
export type Result = (typeof RESULTS)[number];
export const RESULT_LABEL: Record<Result, string> = { edit: "Edit the note", task: "Make a task", answer: "Answer" };
export const RESULT_ABOUT: Record<Result, string> = {
  edit: "Rewrites this note, shown as a diff first", task: "Proposes a task linked to this note", answer: "Reads the note and replies; changes nothing",
};

/** The icons a prompt can have, by name: a client draws each from its own icon set. */
export const ACTION_ICONS = [
  "wand", "tasks", "summary", "sparkles", "pencil", "list", "check", "languages", "scissors", "lightbulb", "calendar", "book", "mail", "hash",
] as const;
export type ActionIcon = (typeof ACTION_ICONS)[number];

/** An assistant action: a saved prompt, run on the open note. */
export type PromptAction = { id: string; label: string; icon: ActionIcon; prompt: string; result: Result };

export const ACTION_LIMITS = { actions: 24, label: 40, prompt: 2000 } as const;

/** The two the app comes with. */
export const DEFAULT_PROMPTS: readonly PromptAction[] = [
  {
    id: "tidy", label: "Tidy", icon: "wand", result: "edit",
    prompt: "Tidy this note: give it clear headings and lists where they help, fix typos and spacing. Keep every fact, link, picture and checkbox, keep my wording and its language, and invent nothing.",
  },
  {
    id: "task", label: "Make a task", icon: "tasks", result: "task",
    prompt: "Make one task from this note: a short title saying what to do, notes carrying what matters from it, and a date, tags or a place only when the note gives them.",
  },
];

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const one = <T extends string>(of: readonly T[], v: unknown, fallback: T): T => of.find((x) => x === v) ?? fallback;

/** One action as stored, or null when it has no usable id, name or prompt. */
export function promptOf(raw: unknown): PromptAction | null {
  const a = obj(raw);
  const label = typeof a.label === "string" ? a.label.replace(/\s+/g, " ").trim().slice(0, ACTION_LIMITS.label) : "";
  const prompt = typeof a.prompt === "string" ? a.prompt.trim().slice(0, ACTION_LIMITS.prompt) : "";
  if (typeof a.id !== "string" || !ID.test(a.id) || isBuiltin(a.id) || !label || !prompt) return null;
  return { id: a.id, label, icon: one(ACTION_ICONS, a.icon, "sparkles"), prompt, result: one(RESULTS, a.result, "answer") };
}

/** Whatever was stored as the owner's actions: nothing stored is the app's two, a stored list is theirs (an empty one too). */
export function promptsOf(raw: unknown): PromptAction[] {
  if (!Array.isArray(raw)) return DEFAULT_PROMPTS.map((p) => ({ ...p }));
  const out: PromptAction[] = [];
  for (const r of raw) {
    const p = promptOf(r);
    if (p && !out.some((o) => o.id === p.id) && out.length < ACTION_LIMITS.actions) out.push(p);
  }
  return out;
}

/** An id for a new action named `label`, unlike any in `taken`. */
export function newActionId(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "action";
  const free = (id: string) => !taken.includes(id) && !isBuiltin(id);
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

/** Why `a` can't be saved, or null: what a form and the agent's tools check alike. */
export function promptProblem(a: Pick<PromptAction, "label" | "prompt">): string | null {
  if (!a.label.trim()) return "It needs a name.";
  if (a.label.trim().length > ACTION_LIMITS.label) return `The name is too long: up to ${ACTION_LIMITS.label} characters.`;
  if (!a.prompt.trim()) return "It needs a prompt: what the assistant should do with the note.";
  if (a.prompt.trim().length > ACTION_LIMITS.prompt) return `The prompt is too long: up to ${ACTION_LIMITS.prompt} characters.`;
  return null;
}

// ---- where each sits

export const SLOT_PLACES = ["header", "menu", "off"] as const;
type SlotPlace = (typeof SLOT_PLACES)[number];
export const SLOT_PLACE_LABEL: Record<SlotPlace, string> = { header: "Header", menu: "Menu", off: "Off" };

/** An action's place in one layout's note header: a built-in's name or a prompt's id. */
export type Slot = { id: string; place: SlotPlace };

type LayoutName = "phone" | "desktop";

/** The most buttons a header holds beside the mic and the menu: a phone's is narrower, and a desktop's shares its row with
 *  the format tools. */
export const HEADER_MAX: Record<LayoutName, number> = { phone: 3, desktop: 4 };

/** A layout's header before the owner changed it: the buttons it always had, then the app's two actions while there is room. */
const DEFAULT_HEADER: Record<LayoutName, readonly string[]> = { phone: ["attach", "pin", "tidy"], desktop: ["attach", "pin", "tidy", "task"] };

/** The slots of a layout nobody set: the default header, then everything else in the menu. */
function defaultSlots(layout: LayoutName, prompts: readonly PromptAction[]): Slot[] {
  const ids = [...BUILTINS, ...prompts.map((p) => p.id)], head = DEFAULT_HEADER[layout].filter((id) => ids.includes(id));
  return [...head.map((id) => ({ id, place: "header" as const })), ...ids.filter((id) => !head.includes(id)).map((id) => ({ id, place: "menu" as const }))];
}

/** Whatever was stored as a layout's slots, whole: stored order kept, an action that is gone dropped, one the list doesn't know
 *  yet (a new prompt, a new built-in) added to the menu, and buttons past the header's room moved to the menu. */
export function slotsOf(raw: unknown, layout: LayoutName, prompts: readonly PromptAction[]): Slot[] {
  if (!Array.isArray(raw)) return defaultSlots(layout, prompts);
  const known = [...BUILTINS, ...prompts.map((p) => p.id)] as string[], out: Slot[] = [];
  let room = HEADER_MAX[layout];
  for (const r of raw) {
    const s = obj(r), id = typeof s.id === "string" ? s.id : "";
    if (!known.includes(id) || out.some((o) => o.id === id)) continue;
    const want = one(SLOT_PLACES, s.place, "menu"), place = want === "header" && room-- <= 0 ? "menu" : want;
    out.push({ id, place });
  }
  return [...out, ...known.filter((id) => !out.some((o) => o.id === id)).map((id) => ({ id, place: "menu" as const }))];
}

/** The ids at `place`, in order. */
export const idsAt = (slots: readonly Slot[], place: SlotPlace): string[] => slots.filter((s) => s.place === place).map((s) => s.id);

/** Whether the header has room for one more button. */
export const headerRoom = (slots: readonly Slot[], layout: LayoutName): boolean => idsAt(slots, "header").length < HEADER_MAX[layout];

/** `slots` with `id` put at `place`; a header that is full keeps it where it was. */
export function placedAt(slots: readonly Slot[], layout: LayoutName, id: string, place: SlotPlace): Slot[] {
  const now = slots.find((s) => s.id === id);
  if (!now || now.place === place || (place === "header" && !headerRoom(slots, layout))) return [...slots];
  return slots.map((s) => (s.id === id ? { id, place } : s));
}

/** The order with `id` dropped before (or `after`) `over`; unchanged when either is unknown or they are the same. */
export function movedSlot(slots: readonly Slot[], id: string, over: string, after: boolean): Slot[] {
  const moving = slots.find((s) => s.id === id);
  if (!moving || id === over || !slots.some((s) => s.id === over)) return [...slots];
  const rest = slots.filter((s) => s.id !== id), to = rest.findIndex((s) => s.id === over) + (after ? 1 : 0);
  return [...rest.slice(0, to), moving, ...rest.slice(to)];
}

// ---- a run

/** What a client sends beside a run's chat request: which action, on which note. The prompt and what it may do are read from
 *  the owner's preferences by the server, never from here. */
export type ActionRun = { id: string; note: string };

/** Whatever arrived as an `ActionRun`, or undefined. */
export function runOf(raw: unknown): ActionRun | undefined {
  const r = obj(raw);
  return typeof r.id === "string" && ID.test(r.id) && typeof r.note === "string" && /^notes\/[^/]+\.md$/.test(r.note) ? { id: r.id, note: r.note } : undefined;
}

/** A run's first message: the action by name, the note by title and path (as handoff.ts names one, so the agent reads it
 *  with its own tools), then the owner's prompt. */
export function runMessage(a: Pick<PromptAction, "label" | "prompt">, note: NoteRef): string {
  return `${a.label}, on my note “${note.title.trim() || noteIdOf(note.path)}” (${note.path}): ${a.prompt.trim()}`;
}

const RUN = /^(.{1,40}), on my note “(.*?)” \((notes\/[^)\s]+\.md)\): /s;

/** `runMessage`'s inverse: the action's name and the note a message opens by naming, and the prompt after them. */
export function ranOn(text: string): { label: string; note: NoteRef; prompt: string } | null {
  const m = RUN.exec(text);
  return m ? { label: m[1], note: { title: m[2], path: m[3] }, prompt: text.slice(m[0].length) } : null;
}

/** A run's chat in the chat list. */
export const runTitle = (a: Pick<PromptAction, "label">, note: NoteRef) => `${a.label}: ${note.title.trim() || noteIdOf(note.path)}`;
