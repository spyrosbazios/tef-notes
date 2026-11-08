// The app's places in the router's terms (router.ts, routes/): Home `/` (its tag filter `?tags=a,b`), the task lists `/inbox`
// `/today` `/upcoming` `/logbook` (the task open beside one `?t=<id>`), `/settings` (`?section=`), and a note laid over any of
// them as `?note=<id>` (the id is the filename's, which never changes, so a link survives a retitle). `/note/<id>`, the link the
// phone and "Copy link" use, is a route that redirects to Home with the note open (routes/note.$id.tsx). `View` is the place
// without the open note or task: what the assistant, the palette and the rail speak. Navigation goes through the router only;
// `useNav` is its verbs, typed against the route tree.
import { fold } from "@/core/notes";
import type { SettingsSection } from "@/lib/route-search";
import { linkOptions, useCanGoBack, useLocation, useMatch, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

export const TASK_VIEWS = ["inbox", "today", "upcoming", "logbook"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type View =
  | { kind: "home"; tags?: string[] } | { kind: TaskView } | { kind: "settings"; section?: SettingsSection };

/** A view that lists tasks, not notes: a Things list. Its list is the task list, with the open task beside it. */
export const isTaskView = (v: View): v is { kind: TaskView } => (TASK_VIEWS as readonly string[]).includes(v.kind);

/** The list a task is opened in when the view it was found from has none of it: the Logbook once done, else the Inbox. */
export const homeOfTask = (t: { done?: string }): View => (t.done ? { kind: "logbook" } : { kind: "inbox" });

/** The view at a path (anything else is Home); Home's tags and Settings' section from its search. */
export function viewOf(path: string, search: { tags?: readonly string[]; section?: SettingsSection } = {}): View {
  if (path === "/settings") return search.section ? { kind: "settings", section: search.section } : { kind: "settings" };
  const tags = search.tags;
  const task = TASK_VIEWS.find((k) => path === `/${k}`);
  if (task) return { kind: task };
  return tags?.length ? { kind: "home", tags: [...tags] } : { kind: "home" };
}

const TITLES: Record<View["kind"], string> = {
  home: "Home", settings: "Settings",
  inbox: "Inbox", today: "Today", upcoming: "Upcoming", logbook: "Logbook",
};
export const titleOf = (v: View) => TITLES[v.kind];

/** What is open on a view: the task beside a task list, the note over any of them. */
export type Open = { task?: string; note?: string };

/** Where a view is, as the router's typed link, with what is open on it. */
export function linkOf(v: View, { task, note }: Open = {}) {
  switch (v.kind) {
    case "home": return linkOptions({ to: "/", search: { tags: v.tags, note } });
    case "settings": return linkOptions({ to: "/settings", search: { section: v.section, note } });
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
  const tags = useSearch({ from: "/_app/", shouldThrow: false })?.tags?.join(",");
  const section = useSearch({ from: "/_app/settings", shouldThrow: false })?.section;
  const view = useMemo(() => viewOf(path, { tags: tags?.split(","), section }), [path, tags, section]);
  const note = useSearch({ from: "/_app", shouldThrow: false })?.note;
  return { view, note, task: isTaskView(view) && typeof search.t === "string" ? search.t : undefined };
}

export function useNav() {
  const { view, note, task } = usePlace();
  const navigate = useNavigate(), canGoBack = useCanGoBack(), router = useRouter();
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
    /** A task opened in a task list of `v`, from a view that has none (a card in the assistant). */
    showTask: (v: View, id: string) => navigate(linkOf(v, { task: id })),
    goView: (v: View) => navigate(linkOf(v)),
    /** Home's notes under exactly these tags. */
    setTags: (tags: string[]) => navigate(linkOf({ kind: "home", tags })),
    /** What clicking a badge does: the tag added to Home's filter. */
    filterTag: (tag: string) => {
      const now = view.kind === "home" ? view.tags ?? [] : [];
      return navigate(linkOf({ kind: "home", tags: now.some((t) => fold(t) === fold(tag)) ? now : [...now, tag] }));
    },
  };
}

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
