// The app's places in the router's terms (router.ts, routes/): Home `/` (its tag filter `?tags=a,b`, its archived notes `?archived=1`), the task lists `/inbox`
// `/today` `/upcoming` `/logbook` (the task open beside one `?t=<id>`), `/notes` (the notes alone, `?tags=` too), `/talk` (the spoken
// conversation), `/settings` (`?section=`), and a note laid over any of
// them as `?note=<id>` (the id is the filename's, which never changes, so a link survives a retitle). `/note/<id>`, the link the
// phone and "Copy link" use, is a route that redirects to Home with the note open (routes/note.$id.tsx). `View` is the place
// without the open note or task: what the assistant, the palette and the rail speak. Navigation goes through the router only;
// `useNav` is its verbs, typed against the route tree.
import { fold } from "@/core/notes";
import type { SettingsSection } from "@/lib/route-search";
import { linkOptions, useCanGoBack, useLocation, useMatch, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Set on the entry `showTask` pushes: the task was opened from another screen, so closing it goes back there. */
    taskFrom?: boolean;
    /** Set on the entry the phone's Ask tab pushes (assistant/dock.tsx `useAskStep`): the dock is open on it, and only on it. */
    ask?: boolean;
  }
}

export const TASK_VIEWS = ["inbox", "today", "upcoming", "logbook"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type View =
  | { kind: "home"; tags?: string[]; archived?: true } | { kind: TaskView } | { kind: "notes"; tags?: string[]; archived?: true }
  | { kind: "settings"; section?: SettingsSection } | { kind: "talk" };

/** A view that lists notes under a tag filter: Home and the Notes page. */
export type NotesView = Extract<View, { kind: "home" | "notes" }>;
export const isNotesView = (v: View): v is NotesView => v.kind === "home" || v.kind === "notes";

/** A view that lists tasks, not notes: a Things list. Its list is the task list, with the open task beside it. */
export const isTaskView = (v: View): v is { kind: TaskView } => (TASK_VIEWS as readonly string[]).includes(v.kind);

/** The list a task is opened in when the view it was found from has none of it: the Logbook once done, else the Inbox. */
export const homeOfTask = (t: { done?: string }): View => (t.done ? { kind: "logbook" } : { kind: "inbox" });

/** The view at a path (anything else is Home); Home's and Notes' tags and archive, and Settings' section, from its search. */
export function viewOf(path: string, search: { tags?: readonly string[]; archived?: boolean; section?: SettingsSection } = {}): View {
  if (path === "/talk") return { kind: "talk" };
  if (path === "/settings") return search.section ? { kind: "settings", section: search.section } : { kind: "settings" };
  const task = TASK_VIEWS.find((k) => path === `/${k}`);
  if (task) return { kind: task };
  const tags = search.tags;
  return { kind: path === "/notes" ? "notes" : "home", ...(tags?.length ? { tags: [...tags] } : {}), ...(search.archived ? { archived: true as const } : {}) };
}

const TITLES: Record<View["kind"], string> = {
  home: "Home", notes: "Notes", settings: "Settings", talk: "Talk",
  inbox: "Inbox", today: "Today", upcoming: "Upcoming", logbook: "Logbook",
};
export const titleOf = (v: View) => TITLES[v.kind];

/** What is open on a view: the task beside a task list, the note over any of them. */
export type Open = { task?: string; note?: string };

/** Where a view is, as the router's typed link, with what is open on it. */
export function linkOf(v: View, { task, note }: Open = {}) {
  switch (v.kind) {
    case "home": return linkOptions({ to: "/", search: { tags: v.tags, archived: v.archived ? "1" : undefined, note } });
    case "notes": return linkOptions({ to: "/notes", search: { tags: v.tags, archived: v.archived ? "1" : undefined, note } });
    case "settings": return linkOptions({ to: "/settings", search: { section: v.section, note } });
    case "talk": return linkOptions({ to: "/talk", search: { note } });
    case "inbox": return linkOptions({ to: "/inbox", search: { t: task, note } });
    case "today": return linkOptions({ to: "/today", search: { t: task, note } });
    case "upcoming": return linkOptions({ to: "/upcoming", search: { t: task, note } });
    case "logbook": return linkOptions({ to: "/logbook", search: { t: task, note } });
  }
}

/** A typed link, as `linkOf` makes them. */
export type AppLink = ReturnType<typeof linkOf>;

/** A note's address to hand out (Copy link, a note's link to another): `/note/<id>`, which opens it over Home. */
export const noteHref = (id: string) => `/note/${encodeURIComponent(id)}`;

/** A note laid over the screen on view (`under`, with its open task), which stays where it is; from anywhere else (the share
 *  page), over Home. */
export const noteLink = (id: string, under: { view: View; task?: string } | null): AppLink =>
  linkOf(under?.view ?? { kind: "home" }, { task: under?.task, note: id });

/** Where the app is: the view on screen, the note over it, the task open beside its list. */
export function usePlace(): { view: View; note: string | undefined; task: string | undefined } {
  const path = useLocation({ select: (l) => l.pathname });
  // Each route's own validated search: the loose one (`strict: false`) merges the raw query in, a `tags` still a string
  const search = useSearch({ strict: false });
  const home = useSearch({ from: "/_app/", shouldThrow: false }), notes = useSearch({ from: "/_app/notes", shouldThrow: false });
  const tags = (home ?? notes)?.tags?.join(","), archived = (home ?? notes)?.archived === "1";
  const section = useSearch({ from: "/_app/settings", shouldThrow: false })?.section;
  const view = useMemo(() => viewOf(path, { tags: tags?.split(","), archived, section }), [path, tags, archived, section]);
  const note = useSearch({ from: "/_app", shouldThrow: false })?.note;
  return { view, note, task: isTaskView(view) && typeof search.t === "string" ? search.t : undefined };
}

export function useNav() {
  const { view, note, task } = usePlace();
  const navigate = useNavigate(), canGoBack = useCanGoBack(), router = useRouter();
  const taskFrom = useLocation({ select: (l) => !!l.state.taskFrom });
  const inShell = !!useMatch({ from: "/_app", shouldThrow: false });
  const here = inShell ? { view, task } : null;
  return {
    view, open: note, task,
    /** A note, over the screen it was found from. */
    openNote: (id: string) => navigate(noteLink(id, here)),
    /** The way back from a note: where the app came from, else the screen under it (a note opened by its address). */
    leaveNote: () => {
      if (canGoBack) router.history.back();
      else void navigate({ ...linkOf(view, { task }), replace: true });
    },
    /** A task opened beside its list (null closes it). */
    openTask: (id: string | null) => navigate(linkOf(view, { task: id ?? undefined })),
    /** A task opened in a task list of `v`, from a view that has none (a note's linked tasks, a card in the assistant). */
    showTask: (v: View, id: string) => navigate({ ...linkOf(v, { task: id }), state: { taskFrom: true } }),
    /** Closing the open task: back where it was opened from when `showTask` brought it, else its list. */
    closeTask: () => {
      if (taskFrom && canGoBack) router.history.back();
      else void navigate(linkOf(view));
    },
    goView: (v: View) => navigate(linkOf(v)),
    /** The notes (the Notes page's when on it, else Home's) under exactly these tags, the archive kept as it is. */
    setTags: (tags: string[]) => navigate(linkOf({ ...notesPlace(view), tags })),
    /** What clicking a badge does: the tag added to the notes' filter (the Notes page's when on it, else Home's). */
    filterTag: (tag: string) => {
      const now = isNotesView(view) ? view.tags ?? [] : [];
      return navigate(linkOf({ ...notesPlace(view), tags: now.some((t) => fold(t) === fold(tag)) ? now : [...now, tag] }));
    },
    /** The archived notes listed instead of the others (false: back to the others), the tag filter kept. */
    showArchived: (on: boolean) => navigate(linkOf({ ...notesPlace(view), tags: isNotesView(view) ? view.tags : undefined, archived: on || undefined })),
  };
}

/** The notes view a filter change stays on: the Notes page's when on it, else Home's, with its archive. */
const notesPlace = (v: View): NotesView => ({ kind: v.kind === "notes" ? "notes" : "home", ...(isNotesView(v) && v.archived ? { archived: true as const } : {}) });

/** A link's intent, for what is not an `<a>` (a note's tile, which holds buttons of its own): the route and its data fetched
 *  ahead on a hover or a focus after the router's preload delay, at once on a touch, as `Link`'s `preload="intent"` does. */
export function useIntent(link: () => AppLink) {
  const router = useRouter(), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const now = () => { clearTimeout(timer.current); void router.preloadRoute(link()).catch(() => {}); };
  const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(now, router.options.defaultPreloadDelay ?? 50); };
  const cancel = () => clearTimeout(timer.current);
  return { onPointerEnter: soon, onPointerLeave: cancel, onFocus: soon, onTouchStart: now };
}
