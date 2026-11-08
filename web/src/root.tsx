import { AnimateUIProvider } from "@animate-ui/react/provider";
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { MotionConfig } from "motion/react";
import { AssistantProvider } from "@/components/assistant/provider";
import { Toaster } from "@/components/ui/sonner";
import { UpdateToast } from "@/components/update-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApplyAppearance, useAppearance } from "@/hooks/appearance";
import { useNarrow } from "@/hooks/media";
import { persister } from "@/lib/offline";
import { buster, MAX_AGE, persistable } from "@/lib/persist";
import App from "./App";

// gcTime is the persisted cache's maxAge or more: a shorter one would discard the restored queries early. Mutations are never
// paused for a connection: the ones left here (tags, lenses, push subscriptions, chat removal) have no local copy to wait in, so
// one that can't reach the server fails at once and is reported. The notes, tasks and links are not mutations: they are written
// to the local copy and sent by the sync (lib/sync.ts), which names the rev each was based on.
const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 2, gcTime: MAX_AGE },
    mutations: { networkMode: "always" },
  },
});

// The tags, lenses, photo lists and link previews, kept in IndexedDB so the app opens offline on what
// was last fetched (lib/persist.ts, lib/offline.ts). Written at most once a second, and at once when the page is hidden.
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void persister.flush(); });

/** Paints the chosen look (and an active lens's colour) on the page; inside the query client, which the lenses need. */
function Look() {
  useApplyAppearance();
  return null;
}

/** The app's providers (the assistant's chat above everything the routes show); the toasts follow the chosen theme's scheme, and on
 *  the phone sit at the top under the inset (the bottom is the tabs' and the keyboard's): `offset` is sonner's for a window over
 *  600px, `mobileOffset` its own below, and the tabs show below `md` (768px), so both carry it. */
export function Root() {
  const { scheme } = useAppearance();
  const narrow = useNarrow();
  const clear = narrow ? { top: "calc(env(safe-area-inset-top) + 0.5rem)" } : undefined;
  return (
    <PersistQueryClientProvider
      client={qc}
      persistOptions={{
        persister, maxAge: MAX_AGE, buster: buster(),
        dehydrateOptions: { shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && persistable(q.queryKey) },
      }}
    >
      <Look />
      <AnimateUIProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={400}>
            <AssistantProvider>
              <App />
            </AssistantProvider>
            <Toaster theme={scheme} position={narrow ? "top-center" : "bottom-right"} offset={clear} mobileOffset={clear} />
            <UpdateToast />
          </TooltipProvider>
        </MotionConfig>
      </AnimateUIProvider>
    </PersistQueryClientProvider>
  );
}
