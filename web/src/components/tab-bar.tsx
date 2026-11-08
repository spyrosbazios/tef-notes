// The phone's bottom bar (mobile/src/app/(tabs)/_layout.tsx): a floating pill with Home, Tasks, Ask and Settings. The tab in
// front shows its label on a capsule tinted by the brand, the others are icons. Below `md` only; the rail does this job from
// `lg`, and the app bar between. Ask is the assistant's dock opened whole (assistant/dock.tsx): a tab, not a page, so it is
// "in front" while the dock is open, and any other tab closes it. Hidden under the keyboard (a composer sits on the keys).
// A dot on Ask: an answer finished while it was not in front (hooks/ask-badge.ts), read when the dock opens.
import { House, ListChecks, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAskUnread } from "@/hooks/ask-badge";
import { setDock, useDock } from "@/hooks/dock";
import { isTaskView, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Tab = "home" | "tasks" | "ask" | "settings";
const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", icon: House }, { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "ask", label: "Ask", icon: Sparkles }, { key: "settings", label: "Settings", icon: Settings },
];

export function TabBar() {
  const { view, goView } = useNav();
  const [{ open }] = useDock();
  const unread = useAskUnread();
  const now: Tab = open ? "ask" : isTaskView(view) ? "tasks" : view.kind === "settings" ? "settings" : "home";
  // The list Tasks goes back to: the one last in front, Today at first
  const lastList = useRef<View>({ kind: "today" });
  useEffect(() => { if (isTaskView(view)) lastList.current = { kind: view.kind }; }, [view]);
  const go = (t: Tab) => {
    if (t === "ask") { setDock({ open: true }); return; }
    setDock({ open: false });
    goView(t === "home" ? { kind: "home" } : t === "settings" ? { kind: "settings" } : lastList.current);
  };
  return (
    <nav aria-label="Tabs" className="relative z-50 h-(--tab-bar) shrink-0 bg-bg px-4 py-2 md:hidden">
      <div className="flex h-full items-center justify-between rounded-full border border-line bg-raised p-1.5 shadow-lg">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = key === now, dot = key === "ask" && unread;
          return (
            <button key={key} type="button" aria-label={dot ? `${label}, new answer` : label} aria-current={on ? "page" : undefined} onClick={() => go(key)}
              className={cn("relative flex h-full items-center justify-center gap-2 rounded-full transition-colors active:opacity-70", on ? "bg-accent px-4 text-brand" : "px-3 text-dim")}>
              <Icon className="size-[22px]" strokeWidth={on ? 2.4 : 2} />
              {on ? <span className="text-sm font-semibold">{label}</span> : null}
              {dot ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-warn" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
