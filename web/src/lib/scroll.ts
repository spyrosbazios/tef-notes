// The scrollers the router puts back (router.ts `scrollRestoration`): each list carries a `data-scroll-restoration-id` naming what
// it shows, and the router keeps one place per id under one key (`SCROLL_KEY`), not per history entry, so a list comes back where
// it was left however it is returned to (a tab, the rail, Back) and another tag filter or lens is another list, starting at the top.
// A note, a task and a chat are scrollers of their own, one id each, so the next one opens at its top and not where the last was left.
// (A note's page lies over the screen it came from, which stays mounted: routes/_app.tsx.) A lens switched on the page is no navigation,
// so the router saves and restores nothing for it: hooks/scroll.ts does.

export const SCROLL_KEY = "app";

// An id is read back as an attribute selector (`[data-scroll-restoration-id="…"]`), so a quote or a backslash in a tag would break it
const of = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").replace(/["\\]/g, "")).join("|");

/** Home's page, per tag filter, archive and lens. */
export const homeScroll = (tags: readonly string[], lens?: string | null, archived = false) => of("home", tags.join(","), lens, archived ? "archived" : "");
/** The Notes page, per tag filter, archive and lens. */
export const notesScroll = (tags: readonly string[], lens?: string | null, archived = false) => of("notes", tags.join(","), lens, archived ? "archived" : "");
/** A task list on a screen of its own, per lens. */
export const listScroll = (kind: string, lens?: string | null) => of("list", kind, lens);
/** One of Home's task box lists, per lens. */
export const boxScroll = (kind: string, lens?: string | null) => of("box", kind, lens);
/** A settings section's page. */
export const settingsScroll = (section: string) => of("settings", section);
/** An open note's page, by its id. */
export const noteScroll = (id: string) => of("note", id);
/** An open task's page, by its id. */
export const taskScroll = (id: string) => of("task", id);
/** Talk's transcript: one, which follows its newest line. */
export const talkScroll = of("talk", "log");
/** A chat's thread, by its id. */
export const chatScroll = (id: string) => of("chat", id);

/** The scrollers that start at the top when the router has no place for them (another filter, lens, section, note, task or chat). */
export const SCROLL_TOP = ["home", "notes", "list", "box", "settings", "note", "task", "chat", "talk"].map((kind) => `[data-scroll-restoration-id^="${kind}|"]`);
