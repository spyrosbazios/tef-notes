// The router (TanStack Router, file routes under routes/, its tree generated into routeTree.gen.ts by the Vite plugin) and the
// query client its loaders fill (lib/loaders.ts). Exported for what navigates from outside React (the service worker's
// `navigate` message, components/update-toast.tsx). The query is plain (lib/route-search.ts), as the addresses handed out are.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { MAX_AGE } from "@/lib/persist";
import { parseSearch, stringifySearch } from "@/lib/route-search";
import { calm } from "@/hooks/media";
import { SCROLL_KEY, SCROLL_TOP } from "@/lib/scroll";
import { Pending } from "@/components/pending";
import { routeTree } from "./routeTree.gen";

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

/** The OS asks for less motion: no View Transition. Read once, as the setting rarely changes under an open app. */
const still = calm();

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
  // Every navigation is a View Transition of the type `route` (index.css styles the theme wipe, type `look`, and no route yet: the
  // seam a page transition hooks into) unless the OS asks for less motion. A browser without typed transitions gets the plain one.
  defaultViewTransition: still ? false : { types: ["route"] },
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
