// Upcoming: its tasks, the open one beside them in a wide window (components/task-screen.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { TaskScreen } from "@/components/task-screen";
import { loadLists } from "@/lib/loaders";

export const Route = createFileRoute("/_app/upcoming")({
  loader: ({ context, preload }) => loadLists(context.queryClient, preload),
  component: TaskScreen,
});
