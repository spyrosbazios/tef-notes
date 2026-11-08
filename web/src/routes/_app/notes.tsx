// Notes: every note on a page of its own (components/notes-page.tsx), `?tags=a,b` narrowing them as on Home.
import { createFileRoute } from "@tanstack/react-router";
import { NotesPage } from "@/components/notes-page";
import { loadLists } from "@/lib/loaders";
import { homeSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app/notes")({
  validateSearch: homeSearch,
  loader: ({ context, preload }) => loadLists(context.queryClient, preload),
  component: NotesPage,
});
