// What another app shared (the manifest's share target, sw/sw.ts): a page of its own, outside the shell. `?shared=1` when the
// service worker stashed a share to take, `err` when it could not read one (components/share-page.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { SharePage } from "@/components/share-page";
import { shareSearch } from "@/lib/route-search";

export const Route = createFileRoute("/share")({
  validateSearch: shareSearch,
  component: SharePage,
});
