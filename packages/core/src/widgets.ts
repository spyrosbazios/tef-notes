// Widgets: what the assistant shows in the chat beyond a note's or a task's card. The model never lays anything out: it calls
// a `show_*` tool of the server agent (server/agent/src/widgetTools.ts), the tool reads the owner's own records and returns typed
// data as the output's `widget`, and each client draws a fixed component for the `type` it finds. Display only: a widget
// writes nothing. A tick on a task row inside one goes through the client's own tick (the take-back second on the phone), like
// a card's; any other change is the model's own tool call afterwards, with its confirm card.
//
//   tool          input                                      widget
//   show_day      { date? }                                  DayWidget: the day's booked hours and its other tasks
//   show_week     { start? }                                 WeekWidget: seven days, each with its counts and top tasks
//   show_review   { days? }                                  ReviewWidget: what got done, added and stalled
//   show_quote    { path, quote }                            QuoteWidget: a passage of a note, checked to be in it
//   show_link     { url }                                    LinkWidget: a page's preview (the server's link-preview route)
//   show_lens     { tags, exclude?, name?, accent? }         LensWidget: what a lens would show, before it is saved
//
// A finished call's output is `{ widget }` or `{ error }`: read it with `widgetOf` (defensive: a chat saved by another version
// still draws, and anything malformed is simply no widget). `find_free_slots` has no widget: plain data for the model.
// Pure: no "ai", RN or DOM import, since the sidecar loads this file outside the clients' node_modules.

import { cardsOf, type NoteCard, type TaskCard } from "./agent";
import { isNotePath } from "./notes";
import { isDay } from "./todo";
import type { LensAccentName } from "./lens";
import type { LinkPreview } from "./pocketbase";
import { ACCENT_NAMES } from "./theme";

/** Task cards a widget lists at most, and how many a lens preview samples of each kind. */
export const WIDGET_LIMITS = { tasks: 20, top: 3, stalled: 5, tags: 5, sample: 5 } as const;

// ---- the types

/** A task booked at an hour: its day and `remind` time. A task has no length, so it holds its whole hour (`at` to `until`, the
 *  end of that hour, "24:00" for 23:xx): the same unit the double-booking check uses. `clash`: another open task holds the
 *  same hour, flag it. */
export type BookedTask = { at: string; until: string; task: TaskCard; clash?: true };

/** One day's open tasks. `booked`: those at an hour, earliest first. `unscheduled`: the rest planned for the day or due on it (no
 *  hour), by their order, at most `WIDGET_LIMITS.tasks`; `more`: how many were left out. `done`: tasks ticked that day.
 *  Draw `date` as the day it is: today's label is the client's. */
export type DayWidget = { type: "day"; date: string; booked: BookedTask[]; unscheduled: TaskCard[]; more?: number; done: number };

/** One day of a week: `open` tasks planned for it or due on it, of which `booked` hold an hour; `overdue`: those still open on a
 *  day that has passed (all of `open` then, else 0). `top`: the first few, booked ones first. */
export type WeekDay = { date: string; open: number; booked: number; overdue: number; top: { id: string; title: string }[] };

/** Seven days from `start` (the Monday of this week unless asked for another day). */
export type WeekWidget = { type: "week"; start: string; days: WeekDay[] };

/** The last `days` days up to today (`from` to `to`, both included). `done`: tasks ticked in them; `added`: tasks made; `notesAdded`
 *  and `notesEdited` (edited: changed in the window, not new in it). `stalled`: open tasks untouched for 14 days or more, the
 *  longest idle first, at most `WIDGET_LIMITS.stalled` (`idle`: whole days since the last change), `stalledTotal` how many there
 *  are in all. `tags`: the busiest tags over what was done, added or touched, most first. */
export type ReviewWidget = {
  type: "review"; from: string; to: string; days: number; done: number; added: number; notesAdded: number; notesEdited: number;
  stalled: { task: TaskCard; idle: number }[]; stalledTotal: number; tags: { tag: string; count: number }[];
};

/** A passage of a note, checked to be in it (whitespace aside, word for word). `before` and `after`: a little of what surrounds it,
 *  "…" where cut. Draw the quote with the note's title, tapping opens `path`. */
export type QuoteWidget = { type: "quote"; path: string; title: string; quote: string; before: string; after: string };

/** A page's preview as a link card (`previewPictureUrl`, `hasPreview` and the card the notes' link tiles draw are core/pocketbase's). */
export type LinkWidget = { type: "link"; preview: LinkPreview };

/** What a lens would show, from the tags alone, before anything is saved: how many notes and (open) tasks pass `inLens`, and up
 *  to `WIDGET_LIMITS.sample` of each as cards, newest note first and tasks by order. `name` and `accent` are the model's proposal
 *  for it, if any. Nothing is written: saving is the owner's step in the app (core/lens.ts `lensProblem`, pocketbase `lenses`). */
export type LensWidget = {
  type: "lens"; tags: string[]; exclude: string[]; name?: string; accent?: LensAccentName;
  notes: { count: number; sample: NoteCard[] }; tasks: { count: number; sample: TaskCard[] };
};

export type Widget = DayWidget | WeekWidget | ReviewWidget | QuoteWidget | LinkWidget | LensWidget;
export type WidgetType = Widget["type"];

/** The tools whose output carries a widget. */
export const WIDGET_TOOLS = ["show_day", "show_week", "show_review", "show_quote", "show_link", "show_lens"] as const;
export type WidgetTool = (typeof WIDGET_TOOLS)[number];
export const isWidgetTool = (name: string): name is WidgetTool => (WIDGET_TOOLS as readonly string[]).includes(name);

// ---- reading one

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown) => list(v).filter((s): s is string => typeof s === "string");
const time = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-4]):[0-5]\d$/.test(v) ? v : "");
const taskCards = (v: unknown) => cardsOf({ cards: v }).filter((c): c is TaskCard => c.kind === "task");
const noteCards = (v: unknown) => cardsOf({ cards: v }).filter((c): c is NoteCard => c.kind === "note");

function readDay(o: Record<string, unknown>): DayWidget | null {
  if (!isDay(str(o.date))) return null;
  const booked = list(o.booked).flatMap((b) => {
    const x = obj(b), at = time(x?.at), until = time(x?.until), [task] = taskCards([x?.task]);
    return x && at && until && task ? [{ at, until, task, ...(x.clash === true ? { clash: true as const } : {}) }] : [];
  });
  return { type: "day", date: str(o.date), booked, unscheduled: taskCards(o.unscheduled), ...(count(o.more) ? { more: count(o.more) } : {}), done: count(o.done) };
}

function readWeek(o: Record<string, unknown>): WeekWidget | null {
  if (!isDay(str(o.start))) return null;
  const days = list(o.days).flatMap((d): WeekDay[] => {
    const x = obj(d);
    if (!x || !isDay(str(x.date))) return [];
    const top = list(x.top).flatMap((t) => { const y = obj(t); return y && str(y.id) && typeof y.title === "string" ? [{ id: str(y.id), title: y.title }] : []; });
    return [{ date: str(x.date), open: count(x.open), booked: count(x.booked), overdue: count(x.overdue), top }];
  });
  return days.length ? { type: "week", start: str(o.start), days } : null;
}

function readReview(o: Record<string, unknown>): ReviewWidget | null {
  if (!isDay(str(o.from)) || !isDay(str(o.to))) return null;
  const stalled = list(o.stalled).flatMap((s) => { const x = obj(s), [task] = taskCards([x?.task]); return x && task ? [{ task, idle: count(x.idle) }] : []; });
  const tags = list(o.tags).flatMap((t) => { const x = obj(t); return x && str(x.tag) ? [{ tag: str(x.tag), count: count(x.count) }] : []; });
  return { type: "review", from: str(o.from), to: str(o.to), days: count(o.days), done: count(o.done), added: count(o.added), notesAdded: count(o.notesAdded),
    notesEdited: count(o.notesEdited), stalled, stalledTotal: Math.max(count(o.stalledTotal), stalled.length), tags };
}

function readQuote(o: Record<string, unknown>): QuoteWidget | null {
  return isNotePath(str(o.path)) && str(o.quote)
    ? { type: "quote", path: str(o.path), title: str(o.title), quote: str(o.quote), before: str(o.before), after: str(o.after) } : null;
}

function readLink(o: Record<string, unknown>): LinkWidget | null {
  const p = obj(o.preview);
  if (!p || !/^https?:\/\//i.test(str(p.url))) return null;
  const preview: LinkPreview = { url: str(p.url), title: str(p.title), description: str(p.description), site: str(p.site), image: str(p.image), icon: str(p.icon), picture: str(p.picture) };
  return preview.title || preview.image ? { type: "link", preview } : null;
}

function readLens(o: Record<string, unknown>): LensWidget | null {
  const n = obj(o.notes), t = obj(o.tasks), accent = ACCENT_NAMES.find((a): a is LensAccentName => a === o.accent && a !== "theme");
  if (!n || !t) return null;
  return {
    type: "lens", tags: strings(o.tags), exclude: strings(o.exclude), ...(str(o.name) ? { name: str(o.name) } : {}), ...(accent ? { accent } : {}),
    notes: { count: count(n.count), sample: noteCards(n.sample) }, tasks: { count: count(t.count), sample: taskCards(t.sample) },
  };
}

/** The widget a finished `show_*` call's `output` carries, read defensively (every field checked, cards by `cardsOf`'s rule); null
 *  for an error, an unknown `type` or a widget that doesn't hold together. A client draws what it returns and nothing else. */
export function widgetOf(output: unknown): Widget | null {
  const w = obj(obj(output)?.widget);
  switch (w?.type) {
    case "day": return readDay(w);
    case "week": return readWeek(w);
    case "review": return readReview(w);
    case "quote": return readQuote(w);
    case "link": return readLink(w);
    case "lens": return readLens(w);
    default: return null;
  }
}
