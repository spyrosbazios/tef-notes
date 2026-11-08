// Settings, `?section=` the one open (components/settings-pane.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPane } from "@/components/settings-pane";
import { settingsSearch } from "@/lib/route-search";

export const Route = createFileRoute("/_app/settings")({
  validateSearch: settingsSearch,
  component: SettingsPane,
});
