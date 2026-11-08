// The scrollers the router puts back (router.ts `scrollRestoration`): each list carries a `data-scroll-restoration-id` naming what
// it shows, and the router keeps one place per id under one key (`SCROLL_KEY`), not per history entry, so a list comes back where
// it was left however it is returned to (a tab, the rail, Back) and another tag filter or lens is another list, starting at the top.
// A note's page does not need it: it lies over the screen it came from, which stays mounted (routes/_app.tsx).

export const SCROLL_KEY = "app";

const of = (...parts: (string | null | undefined)[]) => parts.map((p) => p ?? "").join("|");

/** Home's page, per tag filter and lens. */
export const homeScroll = (tags: readonly string[], lens?: string | null) => of("home", tags.join(","), lens);
/** A task list on a screen of its own, per lens. */
export const listScroll = (kind: string, lens?: string | null) => of("list", kind, lens);
/** One of Home's task box lists, per lens. */
export const boxScroll = (kind: string, lens?: string | null) => of("box", kind, lens);
/** A settings section's page. */
export const settingsScroll = (section: string) => of("settings", section);

/** The scrollers that start at the top when the router has no place for them (another filter, lens or section). */
export const SCROLL_TOP = ['[data-scroll-restoration-id^="home|"]', '[data-scroll-restoration-id^="list|"]', '[data-scroll-restoration-id^="box|"]', '[data-scroll-restoration-id^="settings|"]'];
