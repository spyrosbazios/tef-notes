// The shared elements of a route change (router.ts's view transitions, index.css's rules), and the names they go by.
//
// A tile opening its note: the tile is the view transition's `note-card` in the old page and the note's layer (shell.tsx
// `NoteLayer`) the same name in the new one, so the browser grows the one into the other; closing the note shrinks it back into
// the tile it came from. Container to container: the note's first picture is drawn inside the editor, lazily, and isn't on screen
// when the new page is captured. The tile carries the name for the one transition only (two elements with a name abort it).

import { typedTransitions } from "@/hooks/media";

/** The view-transition name the tile and the note's layer share while one grows into the other. */
export const CARD = "note-card";

/** The tile a note was last opened from: the one it grew from and shrinks back into (kept past a close, which Strict Mode's
 *  second run of an effect would otherwise forget). */
let from: { id: string; tile: HTMLElement } | null = null;
/** The next navigation opens this tile's note from it: router.ts reads it for the transition's type. */
let armed: string | null = null;

const name = (el: HTMLElement, on: boolean) => { el.style.viewTransitionName = on ? CARD : ""; };

/** A tile is opening its note: it is the card in the page about to be left. A browser without typed view transitions plays none of
 *  the card's, and the name alone would make it crossfade the page: nothing is armed there. */
export function arm(id: string, tile: HTMLElement) {
  if (!typedTransitions()) return;
  if (from) name(from.tile, false);
  from = { id, tile };
  armed = id;
  name(tile, true);
}

/** Whether opening note `id` grows it out of its tile (once: the arming is spent). A note opened any other way (a link, the palette, a
 *  search result, Back) is no tile's: the last tile is forgotten, and the note closes the way it came. */
export function grows(id: string): boolean {
  const yes = armed === id;
  armed = null;
  if (!yes && from) { name(from.tile, false); from = null; }
  return yes;
}

/** Whether closing note `id` shrinks it back into a tile that is there to be seen: on the page, in the window, and not behind
 *  something else that holds the page inert (a search drawer, a dialog). The page the note itself holds inert is the way it is
 *  laid over it (shell.tsx `data-under-note`), not an obstruction. */
export function shrinks(id: string): boolean {
  if (!from || from.id !== id || !from.tile.isConnected || from.tile.closest("[inert]:not([data-under-note])")) return false;
  const r = from.tile.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

/** The note's layer is on screen: the tile gives up the name before the new page is captured. */
export function landed() {
  armed = null;
  if (from) name(from.tile, false);
}

/** The note's layer is going (note `id`): its tile takes the name for the new page, and gives it up once that is captured
 *  (two frames on, the snapshot is taken at the first rendering after the update). */
export function leaving(id: string) {
  const f = from;
  if (!f || f.id !== id || !f.tile.isConnected) return;
  name(f.tile, true);
  requestAnimationFrame(() => requestAnimationFrame(() => name(f.tile, false)));
}
