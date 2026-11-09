// Where the app opens (core/prefs.ts `start`, the layout's own): a launch at Home's bare URL (the installed app's start_url) goes to the chosen screen
// instead. Only the page load's own first match of Home, and only from `/` with nothing after it: a link to a view, a note or a
// share is followed as given, and Home reached later (a tab, Back) stays Home. Home's route calls it from `beforeLoad`
// (routes/_app/index.tsx), so the redirect happens before Home renders.
import { redirect } from "@tanstack/react-router";
import { layoutPrefsNow } from "@/hooks/prefs";
import { linkOf } from "./nav";

// The launch URL, read once as the module loads: only a bare `/` can be sent on
let pending = location.pathname === "/" && !location.search;

export function startScreen(preload: boolean) {
  if (preload || !pending) return;
  pending = false;
  const { start } = layoutPrefsNow();
  if (start !== "home") throw redirect({ ...linkOf({ kind: start }), replace: true });
}
