// Where the app opens (core/prefs.ts `start`): a launch at Home's bare URL (the installed app's start_url) goes to the chosen screen
// instead. Once per page load, and only from `/` with nothing after it: a link to a view, a note or a share is followed as given.
import { useLayoutEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { hrefOf } from "@/lib/nav";
import { prefsNow } from "./prefs";

let decided = false;

export function useStartScreen() {
  const [path, go] = useLocation(), search = useSearch();
  useLayoutEffect(() => {
    if (decided) return;
    decided = true;
    const { start } = prefsNow();
    if (path === "/" && !search && start !== "home") go(hrefOf({ kind: start }), { replace: true });
  }, [path, search, go]);
}
