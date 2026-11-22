// Preferences: how the owner likes the app, the one definition of every choice they make, whichever device makes it.
//
// Where a setting is kept (the rule; ask in this order):
//   1. A choice the owner makes, in Settings or by leaving a view a certain way, is a preference: a field of `Prefs`, kept on
//      the server (the `prefs` collection: one record keyed `owner`, its `data` this shape) so every device has it.
//      - The same on every screen (the look, the notes list, the assistant, what it may do and the note actions it runs, the voice, sharing, the lens on): a key,
//        or a group's field.
//      - About one layout (where the app opens, Home's list, the phone's tabs, the desktop's sidebar, a note's header, the editor's format tools, the desktop's bar over a selection): `phone` or `desktop`. A layout
//        is what the window draws, not what the device is: the phone's below `md` (768px: tabs at the bottom), the desktop's from
//        it (the rail). A laptop window made narrow is drawn as a phone's, and follows the phone's preferences.
//   2. The state of a window rather than a choice (the dock open and how wide, the chat it is on, when it was last seen): kept by
//      that device alone, never sent (the web's every key: web/src/lib/storage-keys.ts).
//   3. What lasts only while the app is open (the list Home's box was left on): a component's state, not saved.
// A device holds a copy and sends what it changed field by field over the record's `rev` (prefs-sync.ts), so two devices changing
// different preferences never undo each other's. `prefsOf` reads whatever was stored: an unknown or missing field is its default. A field moved or
// renamed is a migration of the record (server/pb_migrations/1794600000_prefs_layouts.js is one), never a second reader.
// Pure and platform-neutral.
import { actionsOf, DEFAULT_ACTIONS, type Actions } from "./actions";
import { EFFORTS, effortOf, type Effort } from "./agent";
import { selectionSlotsOf, toolSlotsOf, type SelectionSlot, type ToolSlot } from "./format-tools";
import { DEFAULT_PROMPTS, promptsOf, slotsOf, type PromptAction, type Slot } from "./note-actions";
import { isNoteSort, type NoteSort } from "./note-sort";
import { DEFAULT_TALK_MODEL, TALK_MODELS, TALK_SPEED, speedOf, type TalkModel } from "./talk";
import { TASK_LIST_LABEL, type TaskList } from "./things";
import { ACCENT_NAMES, DEFAULT_ACCENT, DEFAULT_THEME, THEME_NAMES, type AccentName, type ThemeName } from "./theme";

// ---- layouts

/** The layouts the app draws, each with preferences of its own. */
const LAYOUTS = ["phone", "desktop"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const LAYOUT_LABEL: Record<Layout, string> = { phone: "Phone", desktop: "Desktop" };

// ---- the choices

/** The phone's bottom bar: its tabs, in the order the owner put them. Settings is always shown (it is where the bar is set). */
const TABS = ["home", "tasks", "notes", "ask", "talk", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { home: "Home", tasks: "Tasks", notes: "Notes", ask: "Ask", talk: "Talk", settings: "Settings" };
export const HIDEABLE: readonly Tab[] = ["tasks", "notes", "ask", "talk"];
/** Tabs off until turned on: Notes, a page of only the notes, which Home already lists under its tasks. */
const OFF: readonly Tab[] = ["notes"];

/** The desktop's sidebar (the rail): the screens it lists, in its order, each of which can be hidden. Home (the logo), Search, the
 *  lens and Settings are always there (Settings is where the sidebar is set). */
export const RAIL = ["inbox", "today", "upcoming", "logbook", "notes", "talk"] as const;
export type RailItem = (typeof RAIL)[number];
export const RAIL_LABEL: Record<RailItem, string> = { ...TASK_LIST_LABEL, notes: "Notes", talk: "Talk" };
/** Off until turned on: Notes, as on the phone. */
const RAIL_OFF: readonly RailItem[] = ["notes"];

/** The task lists Home's box and the Tasks tab open on: every one but the Logbook (things.ts `TASK_LISTS`, names and all). */
export const OPENING_LISTS = ["today", "inbox", "upcoming"] as const satisfies readonly TaskList[];
export type OpeningList = (typeof OPENING_LISTS)[number];

/** Which tabs in the bar show their name. */
export const TAB_LABELS = ["active", "always", "never"] as const;
type TabLabels = (typeof TAB_LABELS)[number];
export const TAB_LABELS_LABEL: Record<TabLabels, string> = { active: "Active tab", always: "Every tab", never: "None" };

/** Where the app opens. */
export const STARTS = ["home", "inbox", "today", "upcoming", "notes"] as const;
type Start = (typeof STARTS)[number];
export const START_LABEL: Record<Start, string> = { home: "Home", inbox: "Inbox", today: "Today", upcoming: "Upcoming", notes: "Notes" };

/** When the assistant opens on a new chat rather than the last one: each time it is opened, once the app has been left,
 *  once it has been off screen for `NEW_CHAT_IDLE_MS`, or only from the New chat button. */
export const NEW_CHATS = ["open", "app", "idle", "never"] as const;
type NewChat = (typeof NEW_CHATS)[number];
export const NEW_CHAT_LABEL: Record<NewChat, string> = { open: "Every time", app: "After leaving the app", idle: "After 30 minutes away", never: "Never" };
export const NEW_CHAT_IDLE_MS = 30 * 60_000;

/** Whether the assistant, back on screen, starts a new chat: `left` the app since it was last seen at `seen` (ms). */
export function newChatDue(on: NewChat, left: boolean, seen: number, now: number): boolean {
  if (on === "open") return true;
  if (on === "app") return left;
  if (on === "idle") return now - seen >= NEW_CHAT_IDLE_MS;
  return false;
}

// ---- the shape

/** What every layout has its own of. */
export type LayoutPrefs = {
  /** The screen the app opens on. */
  start: Start;
  /** The list Home's task box shows first. */
  homeList: OpeningList;
  /** A note's header: every action in order, each a button there, a row in its menu, or off (note-actions.ts). */
  noteHeader: Slot[];
  /** The note editor's format tools: every one in order, each in the bar, under its menu, or off (format-tools.ts). */
  formatTools: ToolSlot[];
};

/** The phone's, with its bottom bar. */
type PhonePrefs = LayoutPrefs & {
  /** Every tab in order, hidden ones included, so one shown again comes back where it was. */
  tabs: Tab[];
  hidden: Tab[];
  /** The bar's labels: the tab in front shows its name, every tab does, or none (icons alone). */
  tabLabels: TabLabels;
  /** The list the Tasks tab opens on. */
  tasksList: OpeningList;
};

/** What the assistant's round button at the corner does: opens the chat, Talk in a small panel at the corner, or a menu of the two. */
export const FAB_ACTIONS = ["chat", "talk", "menu"] as const;
export type FabAction = (typeof FAB_ACTIONS)[number];
export const FAB_ACTION_LABEL: Record<FabAction, string> = { chat: "Chat", talk: "Talk", menu: "Chat or Talk" };

/** The desktop's, with its sidebar. */
type DesktopPrefs = LayoutPrefs & {
  /** The assistant's button (FAB_ACTIONS); the phone has none, Ask is a tab there. */
  fab: FabAction;
  /** The sidebar's screens it doesn't list (a hidden one is still reached by its link, the palette or the start screen). */
  hidden: RailItem[];
  /** The bar over selected words: its tools in order, each shown or not (format-tools.ts); a phone's is the ask alone. */
  selectionBar: SelectionSlot[];
};

export type Prefs = {
  theme: ThemeName;
  accent: AccentName;
  /** The notes list: grouped under its tags, which groups are folded (NO_TAG "" for "No tag"), its sort. */
  notes: { grouped: boolean; collapsed: string[]; sort: NoteSort };
  /** The assistant: the model picked (none is the server's default), its effort, when a new chat starts, and `webGuard`:
   *  whether a "Just do it" write still asks once the chat has read someone else's text (actions.ts `decide`). */
  agent: { model?: string; effort: Effort; newChat: NewChat; webGuard: boolean };
  /** Which of the assistant's writes ask first, go ahead, or are never allowed (actions.ts); the agent's server enforces them. */
  actions: Actions;
  /** The assistant actions a note offers: the owner's saved prompts (note-actions.ts). One value: a device's change replaces the list. */
  noteActions: PromptAction[];
  /** The spoken conversation (talk.ts): the voice model the server speaks through, the Fish voice it speaks in (its
   *  voice-model id; empty: the server's own, TEF_NOTES_TALK_VOICE, else the first voice it can find), and how fast. */
  talk: { model: TalkModel; voice: string; speed: number; agent: TalkAgent };
  /** A link or picture shared from another app: "Add a summary", as last left. */
  clip: { summary: boolean };
  /** The lens on (its record id; lens.ts), null for the unfiltered app. */
  lens: string | null;
  phone: PhonePrefs;
  desktop: DesktopPrefs;
};

/** The chat model and effort Talk thinks with, each unset to follow the assistant's own (`agent`): a spoken reply is
 *  waited for, so a faster model or less effort can suit it better than it suits a typed one. */
type TalkAgent = { model?: string; effort?: Effort };

const talkAgentOf = (raw: unknown): TalkAgent => {
  const a = obj(raw);
  return {
    ...(typeof a.model === "string" && a.model ? { model: a.model } : {}),
    ...((EFFORTS as readonly unknown[]).includes(a.effort) ? { effort: a.effort as Effort } : {}),
  };
};

/** The model (unset: the server's default) and effort a Talk conversation runs with. */
export const talkThinking = (p: Prefs): { model?: string; effort: Effort } => {
  const model = p.talk.agent.model || p.agent.model;
  return { ...(model ? { model } : {}), effort: p.talk.agent.effort ?? p.agent.effort };
};

const layoutDefaults = (layout: Layout): LayoutPrefs => ({ start: "home", homeList: "today", noteHeader: slotsOf(undefined, layout, DEFAULT_PROMPTS),
  formatTools: toolSlotsOf(undefined, layout) });

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME, accent: DEFAULT_ACCENT,
  notes: { grouped: false, collapsed: [], sort: "updated" },
  agent: { effort: effortOf(undefined), newChat: "app", webGuard: true },
  actions: { ...DEFAULT_ACTIONS },
  noteActions: promptsOf(undefined),
  talk: { model: DEFAULT_TALK_MODEL, voice: "", speed: TALK_SPEED.normal, agent: {} },
  clip: { summary: false },
  lens: null,
  phone: { ...layoutDefaults("phone"), tabs: [...TABS], hidden: [...OFF], tabLabels: "active", tasksList: "today" },
  desktop: { ...layoutDefaults("desktop"), hidden: [...RAIL_OFF], fab: "chat", selectionBar: selectionSlotsOf(undefined) },
};

// ---- reading

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const one = <T extends string>(of: readonly T[], v: unknown, fallback: T): T => of.find((x) => x === v) ?? fallback;
const tabsIn = (v: unknown): Tab[] => [...new Set(strings(v).filter((t): t is Tab => (TABS as readonly string[]).includes(t)))];
const railIn = (v: unknown): RailItem[] => RAIL.filter((r) => strings(v).includes(r));

const layoutOf = (l: Record<string, unknown>, layout: Layout, prompts: readonly PromptAction[]): LayoutPrefs => ({
  start: one(STARTS, l.start, "home"),
  homeList: one(OPENING_LISTS, l.homeList, "today"),
  noteHeader: slotsOf(l.noteHeader, layout, prompts),
  formatTools: toolSlotsOf(l.formatTools, layout),
});

/** Whatever was stored as Prefs: the one defensive reader. Tabs keep their stored order, any missing ones appended. */
export function prefsOf(raw: unknown): Prefs {
  const p = obj(raw), notes = obj(p.notes), agent = obj(p.agent), talk = obj(p.talk), clip = obj(p.clip);
  const phone = obj(p.phone), desktop = obj(p.desktop), tabs = tabsIn(phone.tabs), noteActions = promptsOf(p.noteActions);
  return {
    theme: one(THEME_NAMES, p.theme, DEFAULT_THEME),
    accent: one(ACCENT_NAMES, p.accent, DEFAULT_ACCENT),
    notes: {
      grouped: notes.grouped === true,
      collapsed: [...new Set(strings(notes.collapsed))],
      sort: isNoteSort(notes.sort) ? notes.sort : "updated",
    },
    agent: {
      ...(typeof agent.model === "string" && agent.model ? { model: agent.model } : {}),
      effort: effortOf(agent.effort),
      newChat: one(NEW_CHATS, agent.newChat, "app"),
      webGuard: agent.webGuard !== false,
    },
    actions: actionsOf(p.actions),
    noteActions,
    talk: {
      model: TALK_MODELS.find((m) => m === talk.model) ?? DEFAULT_TALK_MODEL,
      voice: typeof talk.voice === "string" ? talk.voice : "",
      speed: speedOf(talk.speed),
      agent: talkAgentOf(talk.agent),
    },
    clip: { summary: clip.summary === true },
    lens: typeof p.lens === "string" && p.lens ? p.lens : null,
    phone: {
      ...layoutOf(phone, "phone", noteActions),
      tabs: [...tabs, ...TABS.filter((t) => !tabs.includes(t))],
      // A tab the stored order doesn't know yet is new to this record: it starts as a new record's would
      hidden: [...new Set([...tabsIn(phone.hidden).filter((t) => HIDEABLE.includes(t)), ...OFF.filter((t) => !tabs.includes(t))])],
      tabLabels: one(TAB_LABELS, phone.tabLabels, "active"),
      tasksList: one(OPENING_LISTS, phone.tasksList, "today"),
    },
    desktop: { ...layoutOf(desktop, "desktop", noteActions), hidden: Array.isArray(desktop.hidden) ? railIn(desktop.hidden) : [...RAIL_OFF],
      fab: one(FAB_ACTIONS, desktop.fab, "chat"), selectionBar: selectionSlotsOf(desktop.selectionBar) },
  };
}

// ---- changes

/** The keys holding a group of fields (`notes`, `agent`, `phone`...): a change names only the fields it sets, and a device's
 *  unsent changes are kept field by field. */
type Group = { [K in keyof Prefs]: Prefs[K] extends readonly unknown[] ? never : Prefs[K] extends object ? K : never }[keyof Prefs];

/** A change: whole keys, and of a group only the fields it sets (`{ notes: { sort } }` leaves the rest of `notes` as it is). */
export type PrefsPatch = { [K in keyof Prefs]?: K extends Group ? Partial<Prefs[K]> : Prefs[K] };

const isKey = (k: string): k is keyof Prefs => Object.hasOwn(DEFAULT_PREFS, k);
const isGroup = (k: string): boolean => isKey(k) && Object.keys(obj(DEFAULT_PREFS[k])).length > 0;

/** What a change sets, as paths: a key (`theme`), or a group's field (`notes.sort`, `phone.tabs`). */
export const patchPaths = (patch: PrefsPatch): string[] =>
  Object.entries(patch).flatMap(([k, v]) => (isGroup(k) ? Object.keys(obj(v)).map((f) => `${k}.${f}`) : [k]));

/** Whether `s` names a preference: a key that is no group, or a field under one that is (an optional field, `agent.model`, too). */
export function isPrefPath(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const [k, f, ...rest] = s.split(".");
  return !rest.length && isKey(k) && (isGroup(k) ? !!f : f === undefined);
}

const at = (from: unknown, path: string): unknown => {
  const [k, f] = path.split(".");
  return f === undefined ? obj(from)[k] : obj(obj(from)[k])[f];
};

/** The value at `path`. */
export const prefAt = (p: Prefs, path: string): unknown => at(p, path);

/** `base` with `top`'s values at `paths`; a value `top` lacks (an optional field) is its absence. */
function overlay(base: Prefs, top: unknown, paths: readonly string[]): Prefs {
  const out: Record<string, unknown> = { ...base };
  for (const path of paths) {
    const [k, f] = path.split(".");
    out[k] = f === undefined ? at(top, path) : { ...obj(out[k]), [f]: at(top, path) };
  }
  return prefsOf(out);
}

/** `p` with `patch` applied. */
export const withPatch = (p: Prefs, patch: PrefsPatch): Prefs => overlay(p, patch, patchPaths(patch));

/** The server's preferences with a device's unsent changes over them: `mine`'s values at `paths`, `theirs` everywhere else. */
export const rebased = (theirs: Prefs, mine: Prefs, paths: readonly string[]): Prefs => overlay(theirs, mine, paths);

/** Every path `p` has a value at: a copy all of whose fields go up (the first save, before the server has a record). */
export const everyPath = (p: Prefs): string[] => patchPaths(p);

// ---- the phone's bar and the desktop's sidebar

/** The screens the desktop's sidebar lists, in order. */
export const shownRail = (p: Pick<DesktopPrefs, "hidden">): RailItem[] => RAIL.filter((r) => !p.hidden.includes(r));

/** The tabs the bar shows, in order. */
export const shownTabs = (p: Pick<PhonePrefs, "tabs" | "hidden">): Tab[] => p.tabs.filter((t) => !p.hidden.includes(t));

/** The tab order with `tab` dropped before (or `after`) `over`; unchanged when either is unknown or they are the same. */
export function movedTab(tabs: readonly Tab[], tab: Tab, over: Tab, after: boolean): Tab[] {
  if (tab === over || !tabs.includes(tab) || !tabs.includes(over)) return [...tabs];
  const rest = tabs.filter((t) => t !== tab), to = rest.indexOf(over) + (after ? 1 : 0);
  return [...rest.slice(0, to), tab, ...rest.slice(to)];
}

/** The record's key: there is one, the owner's. */
export const PREFS_KEY = "owner";
