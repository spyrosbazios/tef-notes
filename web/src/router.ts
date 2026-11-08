// The router (TanStack Router, file routes under routes/, its tree generated into routeTree.gen.ts by the Vite plugin) and the
// query client its loaders fill (lib/loaders.ts). Exported for what navigates from outside React (the service worker's
// `navigate` message, components/update-toast.tsx). The query is plain (lib/route-search.ts), as the addresses handed out are.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { MAX_AGE } from "@/lib/persist";
import { parseSearch, stringifySearch } from "@/lib/route-search";
import { typedTransitions } from "@/hooks/media";
import { grows, shrinks } from "@/lib/morph";
import { SCROLL_KEY, SCROLL_TOP } from "@/lib/scroll";
import { Pending } from "@/components/pending";
import { routeTree } from "./routeTree.gen";

type Where = { pathname: string; search: unknown };
/** One query value of a location, as the router parsed it (lib/route-search.ts: strings only). */
const param = (l: Where, key: string): string | undefined => {
  const v = (l.search as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : undefined;
};

/** The view transition a navigation plays, by what changes (index.css draws each type; every one also carries `route`):
 *  - a note laid over the screen: `note-open`, sliding up over it on a phone, fading in from `md` (`note-grow`: out of the tile it
 *    was opened from, lib/morph.ts), and `note-close` taking it away the way it came (`note-shrink` back into its tile). Whether
 *    the note comes or goes is the address's `?note=`, so Back, the note's own Back and a link all play the right way;
 *  - one note for another: `note-swap`, a crossfade of the layer;
 *  - another screen or settings section: `view`, the page's crossfade (quick on a phone: a tab must feel instant), the
 *    rail, the bars and the dock still around it; to or from the share page, outside the shell: `whole`, the window's;
 *  - the same list under other tags, or a task opened or closed (`?t=`: the phone's task sheet has its own
 *    motion): none, the tiles move in place. */
function transitionOf({ fromLocation: from, toLocation: to, pathChanged }: { fromLocation?: Where; toLocation: Where; pathChanged: boolean }): string[] | false {
  if (!from) return false;
  const was = param(from, "note"), is = param(to, "note");
  if (!was && is) return ["route", grows(is) ? "note-grow" : "note-open"];
  if (was && !is) return ["route", shrinks(was) ? "note-shrink" : "note-close"];
  if (was && is) return was === is ? false : ["route", "note-swap"];
  if (pathChanged) return ["route", from.pathname === "/share" || to.pathname === "/share" ? "whole" : "view"];
  return param(from, "section") !== param(to, "section") ? ["route", "view"] : false;
}

// gcTime is the persisted cache's maxAge or more: a shorter one would discard the restored queries early. Mutations are never
// paused for a connection: the ones left here (tags, lenses, push subscriptions, chat removal) have no local copy to wait in, so
// one that can't reach the server fails at once and is reported. The notes, tasks and links are not mutations: they are written
// to the local copy and sent by the sync (lib/sync.ts), which names the rev each was based on.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 2, gcTime: MAX_AGE },
    mutations: { networkMode: "always" },
  },
});

export const router = createRouter({
  routeTree,
  context: { queryClient },
  parseSearch,
  stringifySearch,
  // A link's route and data fetched on hover or touch; every preload asks the loaders again, which only read the query cache
  // (fresh there for its own staleTime), so the router keeps no second cache of its own
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // A screen whose data is not in the cache (the first visit ever, a sync away) shows the pending screen after a beat, never a flash
  defaultPendingComponent: Pending,
  defaultPendingMs: 400,
  defaultPendingMinMs: 300,
  // A navigation is a View Transition typed by what it changes (`transitionOf`; index.css draws them, crossfades only when the OS
  // asks for less motion). A browser without typed transitions or without View Transitions gets none: untyped, every route change
  // would be the user agent's own crossfade of the whole page, and the tile names (lib/morph.ts) would have nothing to draw.
  defaultViewTransition: typedTransitions() ? { types: transitionOf } : false,
  // Each scroller with a `data-scroll-restoration-id` keeps its place under that id, whatever history entry it was left in: a
  // list comes back where it was from a tab, the rail or Back alike, and one it has no place for starts at the top (lib/scroll.ts)
  scrollRestoration: true,
  getScrollRestorationKey: () => SCROLL_KEY,
  scrollToTopSelectors: SCROLL_TOP,
  scrollRestorationBehavior: "instant",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
