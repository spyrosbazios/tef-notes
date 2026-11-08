// The phone's bottom bar (mobile/src/app/(tabs)/_layout.tsx): a floating pill with Home, Tasks, Notes, Ask and Settings (in the owner's order; Tasks, Notes and Ask hideable, Notes off at first: core/prefs.ts), on Animate UI's
// Bottom Navigation. The tab in front shows its label (`show="active"`) on a capsule tinted by the brand that glides to the next
// one, the others are icons; a press scales them. It does not fold on scroll: the bar is already one row of icons, so a fold would only narrow the label and
// reclaim no height (one that did would move the shell's `--tab-bar` and `--dock-bottom`, shell.tsx, under a scrolling page). Below `md` only; the rail does this job from
// `lg`, and the app bar between. Ask is the assistant's dock opened whole (assistant/dock.tsx): a tab, not a page, so it is
// "in front" while the dock is open, and any other tab closes it. Hidden under the keyboard (a composer sits on the keys).
// A dot on Ask: an answer finished while it was not in front (hooks/ask-badge.ts), read when the dock opens.
import { BottomNavigation, BottomNavigationHighlight, BottomNavigationHighlightItem, BottomNavigationItem, BottomNavigationLabel } from "@animate-ui/react/primitives/bottom-navigation";
import { spring } from "@animate-ui/react/utils/motion";
import { useEffect, useRef } from "react";
import { TAB_ICON } from "@/components/tab-icons";
import { shownTabs, TAB_LABEL, type Tab } from "@/core/prefs";
import { useAskUnread } from "@/hooks/ask-badge";
import { setDock, useDock } from "@/hooks/dock";
import { usePrefs } from "@/hooks/prefs";
import { isTaskView, useNav, type View } from "@/lib/nav";

export function TabBar() {
  const { view, goView } = useNav();
  const [{ open }] = useDock();
  const unread = useAskUnread();
  const prefs = usePrefs(), tabs = shownTabs(prefs);
  const now: Tab = open ? "ask" : isTaskView(view) ? "tasks" : view.kind === "settings" || view.kind === "notes" ? view.kind : "home";
  // The list Tasks goes back to: the one last in front, at first the owner's pick (core/prefs.ts `tasksList`)
  const lastList = useRef<View | null>(null);
  useEffect(() => { if (isTaskView(view)) lastList.current = { kind: view.kind }; }, [view]);
  const go = (t: Tab) => {
    if (t === "ask") { setDock({ open: true }); return; }
    setDock({ open: false });
    goView(t === "tasks" ? lastList.current ?? { kind: prefs.tasksList } : { kind: t });
  };
  return (
    <div className="relative z-50 h-(--tab-bar) shrink-0 bg-bg px-4 py-2 md:hidden">
      <BottomNavigation aria-label="Tabs" value={now} onValueChange={(v) => go(v as Tab)}
        className="flex h-full items-center justify-between rounded-full border border-line bg-raised p-1.5 shadow-lg">
        <BottomNavigationHighlight className="inset-0 rounded-full bg-accent">
          {tabs.map((key) => {
            const label = TAB_LABEL[key], Icon = TAB_ICON[key];
            const dot = key === "ask" && unread;
            return (
              <BottomNavigationHighlightItem key={key} value={key} className="h-full">
                <BottomNavigationItem asChild value={key}>
                  <button type="button" aria-label={dot ? `${label}, new answer` : label}
                    className="group/tab relative flex h-full items-center justify-center rounded-full px-3 text-dim transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-brand">
                    <Icon className="size-[22px] group-data-[state=active]/tab:[stroke-width:2.4]" />
                    <BottomNavigationLabel show="active" transition={spring.slide} className="pr-1 pl-2 text-sm font-semibold">{label}</BottomNavigationLabel>
                    {dot ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-warn" /> : null}
                  </button>
                </BottomNavigationItem>
              </BottomNavigationHighlightItem>
            );
          })}
        </BottomNavigationHighlight>
      </BottomNavigation>
    </div>
  );
}
