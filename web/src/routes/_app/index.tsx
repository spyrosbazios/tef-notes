// Home: the day's tasks and every note (components/home.tsx), `?tags=a,b` narrowing the notes. A bare launch here may go on to the chosen start screen (lib/start.ts).
import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/home";
import { loadLists } from "@/lib/loaders";
import { homeSearch } from "@/lib/route-search";
import { startScreen } from "@/lib/start";

export const Route = createFileRoute("/_app/")({
  validateSearch: homeSearch,
  beforeLoad: ({ preload }) => startScreen(preload),
  loader: ({ context, preload }) => loadLists(context.queryClient, preload),
  component: Home,
});
