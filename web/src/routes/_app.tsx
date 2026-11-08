// The shell's screens (components/shell.tsx: rail, app bar, tabs, dock, palette) and the note laid over whichever is on view:
// `?note=<id>` on any of them, so the screen stays matched and mounted under the note rather than giving the URL up to it. A
// hover or touch on a link to a note lists its attachments ahead (lib/loaders.ts `preloadNote`).
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { preloadNote } from "@/lib/loaders";
import { shellSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app")({
  validateSearch: shellSearch,
  loaderDeps: ({ search }) => ({ note: search.note }),
  loader: ({ context, deps }) => { if (deps.note) preloadNote(context.queryClient, deps.note); },
  component: Shell,
});
