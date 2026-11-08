// Home: the day's tasks and every note (components/home.tsx), `?tags=a,b` narrowing the notes.
import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/home";
import { loadLists } from "@/lib/loaders";
import { homeSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app/")({
  validateSearch: homeSearch,
  loader: ({ context, preload }) => loadLists(context.queryClient, preload),
  component: Home,
});
