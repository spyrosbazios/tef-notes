// The phone's bottom bar (mobile/src/app/(tabs)/_layout.tsx): a floating pill with Home, Tasks, Notes, Ask and Settings (in the owner's order; Tasks, Notes and Ask hideable, Notes off at first: core/prefs.ts `phone`), on Animate UI's
// Bottom Navigation. The tab in front shows its label (`show="active"`) on a capsule tinted by the brand that glides to the next
// one, the others are icons; a press scales them. The pill is liquid glass (quick-liquid's `LiquidGlass`, its optics only: the
// motion stays Animate UI's; the glass is the app's one, hooks/glass.ts): the page scrolling under it is refracted through its rim,
// full on Chromium, frosted elsewhere. The pill is what a route change names (`data-vt="tabs"`, index.css): a snapshot
// can't carry a child's backdrop-filter, so for those frames the transition group blurs in its place. The pill hugs its tabs, centred: as a label folds and unfolds, its width is the
// pill's, so the pill grows and shrinks with it. It floats: no strip behind it, the page runs on under it (shell.tsx `--under-tabs`). `scrollBehavior` stays "none": a fold would only narrow the label and reclaim no
// height (one that did would move the shell's `--tab-bar` and `--dock-bottom`, shell.tsx, under a scrolling page); every view
// scrolls its own container. Below `md` only; the rail does this job from
// `lg`, and the app bar between. Ask is the assistant's dock opened whole (assistant/dock.tsx): a tab, not a page, so it is
// "in front" while the dock is open; it is a step in the history, which any other tab navigates away from, closing it. Hidden under the keyboard (a composer sits on the keys).
// A dot on Ask: an answer finished while it was not in front (hooks/ask-badge.ts), read when the dock opens.
import { haptic } from "@/lib/haptics";
import { BottomNavigation, BottomNavigationHighlight, BottomNavigationHighlightItem, BottomNavigationItem, BottomNavigationLabel } from "@animate-ui/react/primitives/bottom-navigation";
import { spring } from "@animate-ui/react/utils/motion";
import { LiquidGlass } from "quick-liquid/react";
import { useEffect, useRef } from "react";
import { TAB_ICON } from "@/components/tab-icons";
import { shownTabs, TAB_LABEL, type Tab } from "@/core/prefs";
import { useAskUnread } from "@/hooks/ask-badge";
import { setDock, useDock } from "@/hooks/dock";
import { useGlass } from "@/hooks/glass";
import { usePrefs } from "@/hooks/prefs";
import { isTaskView, useNav, type View } from "@/lib/nav";

export function TabBar() {
  const { view, goView } = useNav();
  const [{ open }] = useDock();
  const unread = useAskUnread();
  const { phone } = usePrefs(), tabs = shownTabs(phone);
  const glass = useGlass();
  const now: Tab = open ? "ask" : isTaskView(view) ? "tasks" : view.kind === "settings" || view.kind === "notes" ? view.kind : "home";
  // The list Tasks goes back to: the one last in front, at first the owner's pick (core/prefs.ts `phone.tasksList`)
  const lastList = useRef<View | null>(null);
  useEffect(() => { if (isTaskView(view)) lastList.current = { kind: view.kind }; }, [view]);
  const go = (t: Tab) => {
    haptic("tap");
    if (t === "ask") { setDock({ open: true }); return; }
    goView(t === "tasks" ? lastList.current ?? { kind: phone.tasksList } : { kind: t });
  };
  return (
    <div className="relative z-50 flex h-(--tab-bar) justify-center px-4 py-2 md:hidden">
      <LiquidGlass data-vt="tabs" config={glass} className="pointer-events-auto h-full max-w-full rounded-full [&>.ql-content]:h-full">
      <BottomNavigation aria-label="Tabs" value={now} onValueChange={(v) => go(v as Tab)} scrollBehavior="none"
        className="flex h-full items-center gap-1 p-1.5">
        {/* The capsule glides on spring.selection, but its width on the slower spring.dialog: its target dips as the old label folds and
            the new one unfolds, and chased at the glide's pace the capsule shrank to a circle mid-way; lagging, it keeps near its size */}
        <BottomNavigationHighlight className="inset-0 rounded-full bg-accent" transition={{ ...spring.selection, width: spring.dialog, height: spring.dialog }}>
          {tabs.map((key) => {
            const label = TAB_LABEL[key], Icon = TAB_ICON[key];
            const dot = key === "ask" && unread;
            return (
              <BottomNavigationHighlightItem key={key} value={key} className="h-full">
                <BottomNavigationItem asChild value={key}>
                  <button type="button" aria-label={dot ? `${label}, new answer` : label}
                    className="group/tab relative flex h-full items-center justify-center rounded-full px-3 text-dim transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-brand">
                    <Icon className="size-[22px] group-data-[state=active]/tab:[stroke-width:2.4]" />
                    {phone.tabLabels !== "never" ? <BottomNavigationLabel show={phone.tabLabels} transition={spring.slide} className="pr-1 pl-2 text-sm font-semibold">{label}</BottomNavigationLabel> : null}
                    {dot ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-warn" /> : null}
                  </button>
                </BottomNavigationItem>
              </BottomNavigationHighlightItem>
            );
          })}
        </BottomNavigationHighlight>
      </BottomNavigation>
      </LiquidGlass>
    </div>
  );
}
