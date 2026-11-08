// Logbook: its tasks, `?t=<id>` the one open beside them (components/task-screen.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { TaskScreen } from "@/components/task-screen";
import { loadLists } from "@/lib/loaders";
import { listSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app/logbook")({
  validateSearch: listSearch,
  loader: ({ context }) => loadLists(context.queryClient),
  component: TaskScreen,
});
