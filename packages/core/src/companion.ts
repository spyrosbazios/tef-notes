// The native companion's contract: what the Android app (android/) asks the server for, and an iPhone one after it. A
// companion has no screens of the app's own: it is the entry points a web app can't have (home-screen widgets, the share
// sheet, a quick-settings tile), so everything it shows is worked out here, on the server, and sent ready to draw: the
// rows, their labels, the address each opens in the web app, and the owner's colours (`Look`: their theme, accent and the
// lens on). A companion never reads a collection, never sorts or filters, and holds no palette of its own, which is what
// lets a second one be written in another language without a second copy of the rules.
//
// What a companion does copy is small, and checked: how a share reads as a clip (`shareClip`), the sizes a picture is
// sent at (photos.ts `fit`, `lookSize`), the choices a clip offers and what its save says (clip.ts `choices`, `describe`,
// `summaryNotice`). They run before the server is reached, or beside its answer. test/companion-cases.json holds the
// cases; this core's tests and each companion's run the same file.
//
// Routes, all under /agent/companion (server/agent/src/companion.ts), errors `{error}`:
//   GET  hello                 -> Hello: is this a TEF Notes server, at which contract, in which colours
//   GET  tasks?list=           -> TasksFeed: one of the task lists (TASK_LISTS), under the lens on
//   POST tasks  {title, list?} -> {id}: a new open task (in `today`: planned for today), tagged as the lens tags one
//   POST tasks/:id/done        -> {ok: true}: ticked, a repeating one rolled over (404 when it is gone)
//   GET  notes                 -> NotesFeed: the pinned notes, then the latest, under the lens on
// A share is a clip (clip.ts, the routes the extension calls); `shareClip` shapes one from what the share sheet hands over.
import type { ClipPage } from "./clip";
import { dayLabel, dayParts } from "./dates";
import { inLens, lensAccent, lensTag, lensTheme, type Lens } from "./lens";
import { isNotePath, parseNote, snippetOf } from "./notes";
import { DEFAULT_PREFS, TASK_LISTS, TASK_LIST_LABEL, type Prefs, type TaskList } from "./prefs";
import { taskUrl } from "./push";
import { THEMES, withAccent, type Palette, type Theme } from "./theme";
import { clipOf, fromPost } from "./share";
import { progress } from "./things";
import { views, type Task } from "./todo";

/** Raised when a route's answer changes shape. A companion built for another number says so instead of drawing it wrong. */
export const COMPANION_CONTRACT = 1;

/** The app's name in `Hello`: what tells a companion the address it was given is a TEF Notes server. */
export const COMPANION_APP = "tefnotes";

// ---- the look

/** The owner's colours: the palette of their theme with their accent, or the lens's when one is on (#rrggbb each). */
export type Look = Palette & { scheme: Theme["scheme"] };

export const lookOf = (t: Theme): Look => ({ scheme: t.scheme, ...t.C });

/** The look the web app has now: the lens's theme and accent over the owner's own. */
export const ownerLook = (prefs: Pick<Prefs, "theme" | "accent">, lens: Lens | null): Look =>
  lookOf(withAccent(THEMES[lensTheme(lens, prefs.theme)], lensAccent(lens, prefs.accent)));

/** The look before any server has answered: the default theme. */
export const DEFAULT_LOOK: Look = ownerLook(DEFAULT_PREFS, null);

/** `summary`: "Add a summary", as the owner last left it. `tag`: the tag a note or task made now carries (the lens's first,
 *  lens.ts `lensTag`), null with no lens on. */
export type Hello = { app: typeof COMPANION_APP; contract: number; look: Look; summary: boolean; tag: string | null };

export const helloOf = (prefs: Prefs, lens: Lens | null): Hello =>
  ({ app: COMPANION_APP, contract: COMPANION_CONTRACT, look: ownerLook(prefs, lens), summary: prefs.clip.summary, tag: lensTag(lens) ?? null });

// ---- tasks

/** A task's row. `detail`: the line under its title (its hour, when it is due, its checklist's count), "" when there is
 *  nothing to say. `late`: due before today. `url`: where the web app opens it. */
export type FeedTask = { id: string; title: string; detail: string; late: boolean; url: string };
export type TaskSection = { label: string; tasks: FeedTask[] };

/** One task list. `title`: its heading, the lens on named beside it. `sections`: Today's tasks then This Evening's; the
 *  Inbox whole; Upcoming a section a day. A section with no `label` has no heading. `more`: the tasks past
 *  `FEED_LIMITS.tasks`. */
export type TasksFeed = { contract: number; list: TaskList; title: string; url: string; sections: TaskSection[]; more: number; look: Look };

/** A feed's heading: what it lists, and the lens it is seen through. */
const heading = (what: string, lens: Lens | null) => (lens ? `${what} · ${lens.name}` : what);

export const FEED_LIMITS = { tasks: 40, notes: 20, peek: 140 } as const;

export const taskListOf = (v: unknown): TaskList => TASK_LISTS.find((l) => l === v) ?? "today";

/** Where the web app shows a list (web/src/routes/_app/). */
export const listUrl = (list: TaskList) => `/${list}`;

const feedTask = (t: Task, today: string): FeedTask => {
  const count = progress(t);
  const detail = [
    t.when && t.remind ? t.remind : "",
    t.due ? `Due ${t.due === today ? "today" : dayLabel(t.due, today)}` : "",
    count ? `${count[0]}/${count[1]}` : "",
  ].filter(Boolean).join(" · ");
  return { id: t.id, title: t.title, detail, late: !!t.due && t.due < today, url: taskUrl(t.id) };
};

/** `list` as a feed: the web app's own lists (todo.ts `views`) under `lens`, cut to the limit from the top. */
export function tasksFeed(tasks: readonly Task[], list: TaskList, today: string, lens: Lens | null, look: Look): TasksFeed {
  const v = views(tasks.filter((t) => inLens(lens, t)), today);
  const groups: { label: string; tasks: Task[] }[] =
    list === "today" ? [{ label: "", tasks: v.today }, { label: "This Evening", tasks: v.evening }]
    : list === "inbox" ? [{ label: "", tasks: v.inbox }]
    : v.upcoming.map(({ day, tasks: of }) => { const p = dayParts(day, today); return { label: `${p.label} · ${p.detail}`, tasks: of }; });
  let left: number = FEED_LIMITS.tasks, more = 0;
  const sections: TaskSection[] = [];
  for (const g of groups) {
    const shown = g.tasks.slice(0, left);
    left -= shown.length;
    more += g.tasks.length - shown.length;
    if (shown.length) sections.push({ label: g.label, tasks: shown.map((t) => feedTask(t, today)) });
  }
  return { contract: COMPANION_CONTRACT, list, title: heading(TASK_LIST_LABEL[list], lens), url: listUrl(list), sections, more, look };
}

/** A new task from a companion: its title, and the list it was added from (`today` plans it for today). */
export type NewTask = { title: string; list: TaskList };

export const TASK_TITLE_MAX = 500;

/** The body of `POST tasks`, read defensively; null without a title. */
export function newTaskOf(raw: unknown): NewTask | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.replace(/\s+/g, " ").trim().slice(0, TASK_TITLE_MAX) : "";
  return title ? { title, list: r.list === "today" ? "today" : "inbox" } : null;
}

// ---- notes

/** A note's row. `peek`: the opening of its body as plain text. `color`: its own, when it has one, in the look's theme. */
export type FeedNote = { id: string; title: string; peek: string; pinned: boolean; url: string; color?: { bg: string; fg: string; line: string } };
export type NotesFeed = { contract: number; title: string; url: string; notes: FeedNote[]; more: number; look: Look };

/** What a note's row is made from: the record's columns (server/agent/src/notes.ts `Meta`). */
export type NoteRow = { path: string; text: string; tags: readonly string[]; pinned: boolean; archived: boolean; updated: number };

/** A note's address as it is handed out (web/src/routes/note.$id.tsx). */
export const noteUrl = (id: string) => `/note/${encodeURIComponent(id)}`;

/** The notes as a feed: pinned first, then the latest changed, under `lens`; no archived note, nor the memory file. */
export function notesFeed(rows: readonly NoteRow[], lens: Lens | null, prefs: Pick<Prefs, "theme" | "accent">): NotesFeed {
  const theme = THEMES[lensTheme(lens, prefs.theme)];
  const all = rows.filter((r) => isNotePath(r.path) && !r.archived && inLens(lens, r))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
  const notes = all.slice(0, FEED_LIMITS.notes).map((r): FeedNote => {
    const n = parseNote(r.path, r.text), color = n.color ? theme.NOTE_COLORS[n.color] : undefined;
    return { id: n.id, title: n.title, peek: snippetOf(n.body, FEED_LIMITS.peek), pinned: r.pinned, url: noteUrl(n.id), ...(color ? { color } : {}) };
  });
  return { contract: COMPANION_CONTRACT, title: heading("Notes", lens), url: "/notes", notes, more: all.length - notes.length, look: ownerLook(prefs, lens) };
}

// ---- a share

/** What another app shares, as the phone's share sheet hands it over: the words (Android's EXTRA_TEXT, where a link
 *  usually sits after the page's title), a subject (often the page's title) and whether a picture came with it. */
export type ShareIn = { text: string; subject: string; picture: boolean };

/** The share as a clip (clip.ts), by the web app's own reading of a share (share.ts `fromPost`, `clipOf`): the first link
 *  found is the page, the subject its title, and the words the selection, unless they say no more than the link and the
 *  title. null when there is nothing to clip. */
export function shareClip(s: ShareIn): ClipPage | null {
  const shared = fromPost({ title: s.subject, text: s.text, url: "", files: s.picture ? [{ name: "picture.jpg", type: "image/jpeg" }] : [] });
  return shared && clipOf(shared, null);
}
