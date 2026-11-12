// The left rail: search, the task lists (Inbox to Logbook) and Notes, those of them the owner shows (core/prefs.ts
// `desktop.hidden`, set in Settings → Layout), and at the bottom the lens switcher and settings. The logo
// is the way back to Home (where the notes are). Its counts are those of the lens that is on. The assistant is its own button
// at the corner (assistant/fab.tsx), and tags are Home's filter. It replaces the phone's tabs: every view is one click away. One
// Highlight glides the view's background between the lists and Settings (Home, the logo, has none).
// Folded (`[` or its last button, hooks/rail.ts) it is down to its icons: every icon keeps its place, centred in the narrow
// rail, so the shell only animates the rail's width (shell.tsx) and the words fade out under the clip; a folded item names
// itself in a tooltip.
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { PanelLeftClose, PanelLeftOpen, Search, Settings, type LucideIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { LensSwitcher } from "@/components/lens-switcher";
import { RAIL_ICON } from "@/components/task-icons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toggleRail } from "@/hooks/rail";
import { useViews } from "@/hooks/todo";
import { shownRail } from "@/core/prefs";
import { usePrefs } from "@/hooks/prefs";
import { titleOf, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { ReactElement } from "react";

/** What fades when the rail folds: one line, clipped rather than ellipsed, so it slides under the edge as the rail narrows. */
const words = (folded: boolean) => cn("whitespace-nowrap transition-opacity duration-200", folded && "opacity-0");

/** A folded rail's control names itself on hover; open, its label does. */
function Named({ label, folded, children }: { label: string; folded: boolean; children: ReactElement }) {
  if (!folded) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Item({ icon: Icon, label, count, active, onClick, value, folded }: { icon: LucideIcon; label: string; count?: number; active: boolean; onClick: () => void; value?: string; folded: boolean }) {
  const button = (
    <Named label={label} folded={folded}>
      <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} aria-label={folded ? label : undefined}
        className={cn("flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 text-left text-sm transition-colors",
          active ? "text-accent-foreground font-semibold" : "text-dim hover:bg-muted hover:text-fg")}>
        <Icon className="size-4 shrink-0" />
        <span className={cn("flex-1 overflow-hidden", words(folded))}>{label}</span>
        {count != null ? <span className={cn("text-xs tabular-nums text-faint", words(folded))}>{count}</span> : null}
      </button>
    </Named>
  );
  return value ? <HighlightItem value={value}>{button}</HighlightItem> : button;
}

/** `fold` is given only where the owner can fold the rail, the desktop's (folded or not), never the sheet's. */
export function Rail({ onSearch, onPick, fold }: { onSearch: () => void; onPick?: () => void; fold?: boolean }) {
  const folded = fold === true;
  const { views } = useViews();
  const counts = { inbox: views.inbox.length, today: views.today.length + views.evening.length };
  const { view, goView } = useNav();
  const is = (v: View) => view.kind === v.kind;
  const shown = shownRail(usePrefs().desktop);
  const lists = shown.filter((k) => k !== "notes");
  const go = (v: View) => { goView(v); onPick?.(); };

  return (
    <nav className="flex h-full flex-col gap-4 overflow-x-hidden overflow-y-auto p-3" aria-label="Views">
      <Highlight controlledItems value={view.kind === "home" ? null : view.kind} className="inset-0 rounded-lg bg-accent">
        <button type="button" aria-label="Home" onClick={() => go({ kind: "home" })} className="overflow-hidden rounded-lg px-1.5 pt-1 text-left"><Brand folded={folded} /></button>
        <div>
          <Named label="Search" folded={folded}>
            <Button variant="outline" aria-label={folded ? "Search" : undefined} className="w-full justify-start gap-2.5 overflow-hidden rounded-full px-2.5 text-dim has-[>svg]:px-2.5" onClick={onSearch}>
              <Search /> <span className={cn("flex-1 text-left", words(folded))}>Search</span> <Kbd className={words(folded)}>/</Kbd>
            </Button>
          </Named>
        </div>
        {lists.length ? (
          <div className="space-y-0.5">
            {lists.map((k) => (
              <Item key={k} icon={RAIL_ICON[k]} label={titleOf({ kind: k })} value={k} count={counts[k as keyof typeof counts] || undefined} active={is({ kind: k })} onClick={() => go({ kind: k })} folded={folded} />
            ))}
          </div>
        ) : null}
        {shown.includes("notes") ? <Item icon={RAIL_ICON.notes} value="notes" label="Notes" active={is({ kind: "notes" })} onClick={() => go({ kind: "notes" })} folded={folded} /> : null}
        <div className="flex-1" />
        <div className="space-y-0.5 border-t border-line pt-3">
          <LensSwitcher folded={folded} />
          <Item icon={Settings} value="settings" label="Settings" active={is({ kind: "settings" })} onClick={() => go({ kind: "settings" })} folded={folded} />
          {fold == null ? null : <Item icon={folded ? PanelLeftOpen : PanelLeftClose} label={folded ? "Expand sidebar" : "Collapse sidebar"} active={false} onClick={toggleRail} folded={folded} />}
        </div>
      </Highlight>
    </nav>
  );
}
