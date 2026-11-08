// Today: its tasks, `?t=<id>` the one open beside them (components/task-screen.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { TaskScreen } from "@/components/task-screen";
import { loadLists } from "@/lib/loaders";
import { listSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app/today")({
  validateSearch: listSearch,
  loader: ({ context, preload }) => loadLists(context.queryClient, preload),
  component: TaskScreen,
});
