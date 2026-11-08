// Where the app is, in the URL: the view in the path (Home `/`, the task lists `/inbox` `/today` `/upcoming` `/logbook`,
// `/notes`, `/settings`), Home's tag filter as `?tags=a,b`, and a note as its own page `/note/<id>` (the view behind it is Home).
// The id is the filename, which never changes, so a link to a note survives a retitle. The open task is `?t=<id>` (its
// record id) in a task list.
import { fold } from "@/core/notes";
import { createContext, useContext, useMemo, useState } from "react";
import { useLocation, useRoute, useSearch } from "wouter";

export const TASK_VIEWS = ["inbox", "today", "upcoming", "logbook"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type View =
  | { kind: "home"; tags?: string[] } | { kind: TaskView } | { kind: "notes" } | { kind: "settings" };

/** A view that lists tasks, not notes: a Things list. Its list is the task list, with the open task beside it. */
export const isTaskView = (v: View): v is { kind: TaskView } => (TASK_VIEWS as readonly string[]).includes(v.kind);

/** The list a task is opened in when the view it was found from has none of it: the Logbook once done, else the Inbox. */
export const homeOfTask = (t: { done?: string }): View => (t.done ? { kind: "logbook" } : { kind: "inbox" });

/** The view at a path; Home's tags come from the query, `tags`. */
export function viewOf(path: string, tags?: string | null): View {
  if (path === "/settings") return { kind: "settings" };
  if (path === "/notes") return { kind: "notes" };
  const task = TASK_VIEWS.find((k) => path === `/${k}`);
  if (task) return { kind: task };
  const t = tags?.split(",").filter(Boolean) ?? [];
  return t.length ? { kind: "home", tags: t } : { kind: "home" };
}

/** A view's URL; Home's tags as the query, each encoded (a tag may hold a comma's neighbours, never a comma). */
export const hrefOf = (v: View) =>
  v.kind === "home" ? (v.tags?.length ? `/?tags=${v.tags.map(encodeURIComponent).join(",")}` : "/") : `/${v.kind}`;

const TITLES: Record<View["kind"], string> = {
  home: "Home", notes: "Notes", settings: "Settings",
  inbox: "Inbox", today: "Today", upcoming: "Upcoming", logbook: "Logbook",
};
export const titleOf = (v: View) => TITLES[v.kind];

/** A note's page. */
export const noteHref = (id: string) => `/note/${encodeURIComponent(id)}`;

/** Marks a history entry as one the app pushed, so a note's Back can go back to it rather than leave the app. */
const FROM_APP = { fromApp: true };

/** A place in the URL. */
export type Here = { path: string; search: string };

/** The view and the open task at a place. */
export function placeOf({ path, search }: Here): { view: View; task: string | undefined } {
  const params = new URLSearchParams(search);
  return { view: viewOf(path, params.get("tags")), task: params.get("t") ?? undefined };
}

/** A note's page lies over the screen it was opened from, which stays mounted and keeps its scroll, tiles and pictures. That screen
 *  reads its place from here, not from the URL: the URL is the note's. */
export const Behind = createContext<Here | null>(null);

/** The last place that was not a note's page (Home at first: a note opened from a link has nothing behind it). */
export function useBehind(): Here {
  const [path] = useLocation(), search = useSearch(), [onNote] = useRoute("/note/:id");
  const live = useMemo(() => ({ path, search }), [path, search]);
  const [kept, keep] = useState<Here>({ path: "/", search: "" });
  if (!onNote && kept !== live) keep(live);
  return onNote ? kept : live;
}

/** Where the screen on view is: the URL's place, or what lies behind a note's page when it is the screen being read. */
export function useHere() {
  const behind = useContext(Behind), [path, go] = useLocation(), search = useSearch();
  const here = behind ?? { path, search };
  const params = useMemo(() => new URLSearchParams(here.search), [here.search]);
  return { here, params, go };
}

export function useNav() {
  const { here, go } = useHere();
  const [onNote, note] = useRoute("/note/:id");
  const { view, task } = placeOf(here);
  /** The note on the page. */
  const open = onNote ? note.id : undefined;
  return {
    view, open, task,
    /** A note, on its own page, from wherever it was found. */
    openNote: (id: string) => go(noteHref(id), { state: FROM_APP }),
    /** The way back from a note's page: where the app came from, else Home. */
    leaveNote: () => { if (history.state?.fromApp) history.back(); else go("/"); },
    /** A task opened beside its list (null closes it). */
    openTask: (id: string | null) => go(id ? `${hrefOf(view)}?t=${encodeURIComponent(id)}` : hrefOf(view)),
    /** A task opened in a task list of `v`, from a view that has none (a card in the assistant). */
    showTask: (v: View, id: string) => go(`${hrefOf(v)}?t=${encodeURIComponent(id)}`),
    goView: (v: View) => go(hrefOf(v)),
    /** Home's notes under exactly these tags. */
    setTags: (tags: string[]) => go(hrefOf({ kind: "home", tags })),
    /** What clicking a badge does: the tag added to Home's filter. */
    filterTag: (tag: string) => {
      const now = view.kind === "home" ? view.tags ?? [] : [];
      go(hrefOf({ kind: "home", tags: now.some((t) => fold(t) === fold(tag)) ? now : [...now, tag] }));
    },
  };
}
