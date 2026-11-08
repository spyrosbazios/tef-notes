import { AnimateUIProvider } from "@animate-ui/react/provider";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApplyAppearance } from "@/hooks/appearance";
import { usePrefsSync } from "@/hooks/prefs";
import { persister } from "@/lib/offline";
import { buster, MAX_AGE, persistable } from "@/lib/persist";
import { queryClient, router } from "./router";

// The tags, lenses, photo lists and link previews, kept in IndexedDB so the app opens offline on what
// was last fetched (lib/persist.ts, lib/offline.ts). Written at most once a second, and at once when the page is hidden.
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void persister.flush(); });

/** Keeps the preferences in step with the server (hooks/prefs.ts) and paints the chosen look (and an active lens's colour) on the page; inside the query client, which the lenses need. */
function Look() {
  usePrefsSync();
  useApplyAppearance();
  return null;
}

/** The providers every route sits in, then the router (router.ts), whose root (routes/__root.tsx) holds the rest. */
export function Root() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister, maxAge: MAX_AGE, buster: buster(),
        dehydrateOptions: { shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && persistable(q.queryKey) },
      }}
    >
      <Look />
      <AnimateUIProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={400}>
            <RouterProvider router={router} />
          </TooltipProvider>
        </MotionConfig>
      </AnimateUIProvider>
    </PersistQueryClientProvider>
  );
}
