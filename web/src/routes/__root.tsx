// The root: the providers that need the router (the assistant, which drives it), the toasts, and either the shell's screens
// (_app.tsx), the share page or the 404. Its context is the query client the loaders fill (router.ts, lib/loaders.ts).
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { Frame } from "@/components/frame";
import { NotFound } from "@/components/not-found";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Frame,
  notFoundComponent: NotFound,
});
