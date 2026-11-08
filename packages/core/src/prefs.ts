// Preferences: how the owner likes the app, kept on the server so the laptop and the phone agree. One record of the
// `prefs` collection (pb_migrations/1794400000_prefs.js), keyed `owner`, holding `data`: a Prefs, read back through `prefsOf`
// whatever was stored (an unknown or missing field is its default). Edited whole: the last save wins. Which lens is on is one
// of them, so every device shows the same filter.
// Pure and platform-neutral.
import { effortOf, type Effort } from "./agent";
import { isNoteSort, type NoteSort } from "./note-sort";
import { keepOf, type Keep } from "./voice";
import { ACCENT_NAMES, DEFAULT_ACCENT, DEFAULT_THEME, THEME_NAMES, type AccentName, type ThemeName } from "./theme";

/** The phone's bottom bar: its tabs, in the order the owner put them. Settings is always shown (it is where the bar is set). */
export const TABS = ["home", "tasks", "notes", "ask", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { home: "Home", tasks: "Tasks", notes: "Notes", ask: "Ask", settings: "Settings" };
export const HIDEABLE: readonly Tab[] = ["tasks", "notes", "ask"];
/** Tabs off until turned on: Notes, a page of only the notes, which Home already lists under its tasks. */
const OFF: readonly Tab[] = ["notes"];

/** The task lists Home's box and the Tasks tab open on. */
export const TASK_LISTS = ["today", "inbox", "upcoming"] as const;
export type TaskList = (typeof TASK_LISTS)[number];
export const TASK_LIST_LABEL: Record<TaskList, string> = { today: "Today", inbox: "Inbox", upcoming: "Upcoming" };

/** Which tabs in the bar show their name. */
export const TAB_LABELS = ["active", "always", "never"] as const;
export type TabLabels = (typeof TAB_LABELS)[number];
export const TAB_LABELS_LABEL: Record<TabLabels, string> = { active: "Active tab", always: "Every tab", never: "None" };

/** Where the app opens. */
export const STARTS = ["home", "inbox", "today", "upcoming", "notes"] as const;
export type Start = (typeof STARTS)[number];
export const START_LABEL: Record<Start, string> = { home: "Home", inbox: "Inbox", today: "Today", upcoming: "Upcoming", notes: "Notes" };

/** When the assistant opens on a new chat rather than the last one: each time it is opened, once the app has been left,
 *  once it has been off screen for `NEW_CHAT_IDLE_MS`, or only from the New chat button. */
export const NEW_CHATS = ["open", "app", "idle", "never"] as const;
export type NewChat = (typeof NEW_CHATS)[number];
export const NEW_CHAT_LABEL: Record<NewChat, string> = { open: "Every time", app: "After leaving the app", idle: "After 30 minutes away", never: "Never" };
export const NEW_CHAT_IDLE_MS = 30 * 60_000;

/** Whether the assistant, back on screen, starts a new chat: `left` the app since it was last seen at `seen` (ms). */
export function newChatDue(on: NewChat, left: boolean, seen: number, now: number): boolean {
  if (on === "open") return true;
  if (on === "app") return left;
  if (on === "idle") return now - seen >= NEW_CHAT_IDLE_MS;
  return false;
}

export type Prefs = {
  theme: ThemeName;
  accent: AccentName;
  /** The notes list: grouped under its tags, which groups are folded (NO_TAG "" for "No tag"), its sort. */
  notes: { grouped: boolean; collapsed: string[]; sort: NoteSort };
  /** The assistant: the model picked (none is the server's default), its effort, notes written without asking, when a new chat starts. */
  agent: { model?: string; effort: Effort; unasked: boolean; newChat: NewChat };
  /** Every tab in order, hidden ones included, so one shown again comes back where it was. */
  tabs: Tab[];
  hidden: Tab[];
  /** The bar's labels: the tab in front shows its name, every tab does, or none (icons alone). */
  tabLabels: TabLabels;
  start: Start;
  /** The list Home's task box shows first, and the one the Tasks tab opens on. */
  homeList: TaskList;
  tasksList: TaskList;
  /** Voice input: how long the server keeps its speech model loaded once idle, in seconds (voice.ts). */
  voice: { keep: Keep };
  /** The lens on (its record id; lens.ts), none for the unfiltered app. */
  lens?: string;
};

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME, accent: DEFAULT_ACCENT,
  notes: { grouped: false, collapsed: [], sort: "updated" },
  agent: { effort: effortOf(undefined), unasked: false, newChat: "app" },
  tabs: [...TABS], hidden: [...OFF], tabLabels: "active", start: "home", homeList: "today", tasksList: "today",
  voice: { keep: keepOf(undefined) },
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const tabsIn = (v: unknown): Tab[] => [...new Set(strings(v).filter((t): t is Tab => (TABS as readonly string[]).includes(t)))];

/** Whatever was stored as Prefs: the one defensive reader. Tabs keep their stored order, any missing ones appended. */
export function prefsOf(raw: unknown): Prefs {
  const p = obj(raw), notes = obj(p.notes), agent = obj(p.agent), voice = obj(p.voice);
  const tabs = tabsIn(p.tabs);
  return {
    theme: THEME_NAMES.find((n) => n === p.theme) ?? DEFAULT_THEME,
    accent: ACCENT_NAMES.find((a) => a === p.accent) ?? DEFAULT_ACCENT,
    notes: {
      grouped: notes.grouped === true,
      collapsed: [...new Set(strings(notes.collapsed))],
      sort: isNoteSort(notes.sort) ? notes.sort : "updated",
    },
    agent: {
      ...(typeof agent.model === "string" && agent.model ? { model: agent.model } : {}),
      effort: effortOf(agent.effort), unasked: agent.unasked === true,
      newChat: NEW_CHATS.find((n) => n === agent.newChat) ?? "app",
    },
    tabs: [...tabs, ...TABS.filter((t) => !tabs.includes(t))],
    // A tab the stored order doesn't know yet is new to this record: it starts as a new record's would
    hidden: [...new Set([...tabsIn(p.hidden).filter((t) => HIDEABLE.includes(t)), ...OFF.filter((t) => !tabs.includes(t))])],
    tabLabels: TAB_LABELS.find((l) => l === p.tabLabels) ?? "active",
    start: STARTS.find((s) => s === p.start) ?? "home",
    homeList: TASK_LISTS.find((l) => l === p.homeList) ?? "today",
    tasksList: TASK_LISTS.find((l) => l === p.tasksList) ?? "today",
    voice: { keep: keepOf(voice.keep) },
    ...(typeof p.lens === "string" && p.lens ? { lens: p.lens } : {}),
  };
}

/** The tabs the bar shows, in order. */
export const shownTabs = (p: Pick<Prefs, "tabs" | "hidden">): Tab[] => p.tabs.filter((t) => !p.hidden.includes(t));

/** The tab order with `tab` dropped before (or `after`) `over`; unchanged when either is unknown or they are the same. */
export function movedTab(tabs: readonly Tab[], tab: Tab, over: Tab, after: boolean): Tab[] {
  if (tab === over || !tabs.includes(tab) || !tabs.includes(over)) return [...tabs];
  const rest = tabs.filter((t) => t !== tab), at = rest.indexOf(over) + (after ? 1 : 0);
  return [...rest.slice(0, at), tab, ...rest.slice(at)];
}

/** The record's key: there is one, the owner's. */
export const PREFS_KEY = "owner";
