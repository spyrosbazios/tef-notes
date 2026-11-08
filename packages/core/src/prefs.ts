// Preferences: how the owner likes the app, kept on the server so the laptop and the phone agree. One record of the
// `prefs` collection (pb_migrations/1794400000_prefs.js), keyed `owner`, holding `data`: a Prefs, read back through `prefsOf`
// whatever was stored (an unknown or missing field is its default). Edited whole: the last save wins. Which lens is on is one
// of them, so every device shows the same filter.
// Pure and platform-neutral.
import { effortOf, type Effort } from "./agent";
import { isNoteSort, type NoteSort } from "./note-sort";
import { ACCENT_NAMES, DEFAULT_ACCENT, DEFAULT_THEME, THEME_NAMES, type AccentName, type ThemeName } from "./theme";

/** The phone's bottom bar: its tabs, in the order the owner put them. Settings is always shown (it is where the bar is set). */
export const TABS = ["home", "tasks", "ask", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { home: "Home", tasks: "Tasks", ask: "Ask", settings: "Settings" };
export const HIDEABLE: readonly Tab[] = ["tasks", "ask"];

/** Where the app opens. */
export const STARTS = ["home", "inbox", "today", "upcoming"] as const;
export type Start = (typeof STARTS)[number];
export const START_LABEL: Record<Start, string> = { home: "Home", inbox: "Inbox", today: "Today", upcoming: "Upcoming" };

export type Prefs = {
  theme: ThemeName;
  accent: AccentName;
  /** The notes list: grouped under its tags, which groups are folded (NO_TAG "" for "No tag"), its sort. */
  notes: { grouped: boolean; collapsed: string[]; sort: NoteSort };
  /** The assistant: the model picked (none is the server's default), its effort, notes written without asking. */
  agent: { model?: string; effort: Effort; unasked: boolean };
  /** Every tab in order, hidden ones included, so one shown again comes back where it was. */
  tabs: Tab[];
  hidden: Tab[];
  start: Start;
  /** The lens on (its record id; lens.ts), none for the unfiltered app. */
  lens?: string;
};

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME, accent: DEFAULT_ACCENT,
  notes: { grouped: false, collapsed: [], sort: "updated" },
  agent: { effort: effortOf(undefined), unasked: false },
  tabs: [...TABS], hidden: [], start: "home",
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const tabsIn = (v: unknown): Tab[] => [...new Set(strings(v).filter((t): t is Tab => (TABS as readonly string[]).includes(t)))];

/** Whatever was stored as Prefs: the one defensive reader. Tabs keep their stored order, any missing ones appended. */
export function prefsOf(raw: unknown): Prefs {
  const p = obj(raw), notes = obj(p.notes), agent = obj(p.agent);
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
    },
    tabs: [...tabs, ...TABS.filter((t) => !tabs.includes(t))],
    hidden: tabsIn(p.hidden).filter((t) => HIDEABLE.includes(t)),
    start: STARTS.find((s) => s === p.start) ?? "home",
    ...(typeof p.lens === "string" && p.lens ? { lens: p.lens } : {}),
  };
}

/** The tabs the bar shows, in order. */
export const shownTabs = (p: Pick<Prefs, "tabs" | "hidden">): Tab[] => p.tabs.filter((t) => !p.hidden.includes(t));

/** The tab order with `tab` moved one place along (`by` -1 earlier, 1 later); unchanged at an end. */
export function movedTab(tabs: readonly Tab[], tab: Tab, by: -1 | 1): Tab[] {
  const i = tabs.indexOf(tab), j = i + by, next = [...tabs];
  if (i < 0 || j < 0 || j >= tabs.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** The record's key: there is one, the owner's. */
export const PREFS_KEY = "owner";
