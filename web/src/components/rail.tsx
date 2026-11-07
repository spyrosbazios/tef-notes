// The left rail: search, the task lists (Inbox to Logbook), and at the bottom the lens switcher and settings. The logo
// is the way back to Home (where the notes are). Its counts are those of the lens that is on. The assistant is its own button
// at the corner (assistant/fab.tsx), and tags are Home's filter. It replaces the phone's tabs: every view is one click away.
import { Search, Settings, type LucideIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { LensSwitcher } from "@/components/lens-switcher";
import { TASK_ICON } from "@/components/task-icons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useViews } from "@/hooks/todo";
import { TASK_VIEWS, titleOf, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";

function Item({ icon: Icon, label, count, active, onClick }: { icon: LucideIcon; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground font-semibold" : "text-dim hover:bg-muted hover:text-fg")}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {count != null ? <span className="text-xs tabular-nums text-faint">{count}</span> : null}
    </button>
  );
}

export function Rail({ onSearch, onPick }: { onSearch: () => void; onPick?: () => void }) {
  const { views } = useViews();
  const counts = { inbox: views.inbox.length, today: views.today.length + views.evening.length };
  const { view, goView } = useNav();
  const is = (v: View) => view.kind === v.kind;
  const go = (v: View) => { goView(v); onPick?.(); };

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3" aria-label="Views">
      <button type="button" aria-label="Home" onClick={() => go({ kind: "home" })} className="rounded-lg px-2 pt-1 text-left"><Brand /></button>
      <div>
        <Button variant="outline" className="w-full justify-start rounded-full text-dim" onClick={onSearch}>
          <Search /> <span className="flex-1 text-left">Search</span> <Kbd>/</Kbd>
        </Button>
      </div>
      <div className="space-y-0.5">
        {TASK_VIEWS.map((k) => (
          <Item key={k} icon={TASK_ICON[k]} label={titleOf({ kind: k })} count={counts[k as keyof typeof counts] || undefined} active={is({ kind: k })} onClick={() => go({ kind: k })} />
        ))}
      </div>
      <div className="flex-1" />
      <div className="space-y-0.5 border-t border-line pt-3">
        <LensSwitcher />
        <Item icon={Settings} label="Settings" active={is({ kind: "settings" })} onClick={() => go({ kind: "settings" })} />
      </div>
    </nav>
  );
}
