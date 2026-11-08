// Where each list was scrolled to, and what Home's task box showed, for as long as the app is open. A tab switch replaces the list, a
// task hides its list on a phone: each unmounts or hides the scroller and the browser forgets its place (wouter does nothing about
// it), so a way back lands at the top with the task box on its first list. (A note's page does not: it lies over the screen, which stays mounted.) The hook that keeps and
// restores it is `hooks/scroll-memory.ts`; this is the store and the keys, nothing of React or the DOM.

const tops = new Map<string, number>();

/** A list's place: its view's URL (Home's tag filter is in it) and the lens that is on, since another lens is another list. */
export const scrollKey = (href: string, lens?: string | null) => `${href}|${lens ?? ""}`;

/** Where `key` was left (0 when it never was). */
export const scrollOf = (key: string) => tops.get(key) ?? 0;

/** Keep `top` for `key`; the top is forgotten rather than stored. */
export function keepScroll(key: string, top: number) {
  const t = Math.round(top);
  if (t > 0) tops.set(key, t); else tops.delete(key);
}

/** Home's task box: the list in front. */
export type Box = { tab: "today" | "inbox" | "upcoming" };
let box: Box | null = null;
/** The box as last left, or null before it was: it opens on the owner's pick (core/prefs.ts `homeList`). */
export const boxOf = (): Box | null => box;
export const keepBox = (b: Box) => { box = b; };

/** How long a restore keeps re-applying its place while the list's content grows under it (pictures, the next page of tiles). */
export const SETTLE_MS = 1500;
