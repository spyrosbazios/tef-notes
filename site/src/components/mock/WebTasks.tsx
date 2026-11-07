import { Bell, Calendar, Flag, NotebookText, Plus, Repeat, Star, Tag as TagIcon, Trash2, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { Evening, Radio, Tag, TaskRow, WebShell } from "./parts";

const Pill = ({ children, none }: { children: ReactNode; none?: boolean }) => (
  <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-sm", none ? "text-faint" : "text-fg")}>{children}</span>
);

const FIELDS: { icon: LucideIcon; label: string; value: ReactNode; none?: boolean; clear?: boolean; bare?: boolean; add?: boolean }[] = [
  { icon: Calendar, label: "When", value: "Thursday", clear: true },
  { icon: Flag, label: "Deadline", value: "None", none: true },
  { icon: Repeat, label: "Repeat", value: "Never", none: true },
  { icon: Bell, label: "Reminder", value: "None", none: true },
  { icon: TagIcon, label: "Tags", value: <span className="flex items-center gap-2"><Tag name="travel" remove className="h-6 text-xs" /><span className="flex h-6 items-center gap-1 text-xs text-faint"><Plus className="size-3" />tag</span></span>, bare: true },
  { icon: NotebookText, label: "Notes", value: <>Autumn trip: Lisbon in five days<X className="size-3.5 text-faint" /></>, add: true },
];

const CHECKLIST: [string, boolean][] = [["Passport", true], ["Charger and adapter", true], ["Rain jacket", false], ["Walking shoes", false]];

/** The Today list, This Evening below it, and a task open beside it: its checklist, its fields, its tags and its note. */
export function WebTasks() {
  return (
    <WebShell active="today">
      <section className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden border-r border-line">
        <header className="flex items-start justify-between px-4 pb-2 pt-4">
          <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight"><Star className="size-5 text-brand" />Today</h2>
          <span className="mt-0.5 flex size-7 items-center justify-center text-dim"><Plus className="size-4" /></span>
        </header>
        <div className="px-2">
          <TaskRow task={{ title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] }} />
          <TaskRow selected task={{ title: "Pack the carry-on", checklist: [2, 4], when: "Thursday", tags: ["travel"] }} />
          <TaskRow task={{ title: "Print the apartment check-in details", due: "Saturday" }} />
          <TaskRow task={{ title: "Water the plants", every: "Every 3 days", tags: ["home"] }} />
          <TaskRow task={{ title: "Take out the recycling", done: true }} />
        </div>
        <Evening />
        <div className="px-2"><TaskRow task={{ title: "Read for twenty minutes", remind: "21:00", tags: ["reading"] }} /></div>
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-line px-4">
          <Calendar className="size-4 text-brand" />
          <span className="ml-1 flex h-7 items-center gap-1.5 rounded-lg bg-down px-2.5 text-[0.8rem] font-medium text-bg"><Trash2 className="size-3.5" />Delete</span>
        </div>
        <div className="mx-auto w-[496px] space-y-5 pt-8">
          <div className="flex items-start gap-3"><span className="mt-2"><Radio size={24} /></span><h1 className="h-10 px-2 text-2xl font-extrabold leading-10 tracking-tight">Pack the carry-on</h1></div>
          <p className="min-h-16 px-2 text-sm text-faint">Notes</p>
          <div className="space-y-0.5">
            {CHECKLIST.map(([t, on]) => (
              <div key={t} className={cn("flex items-center gap-2.5 px-1 py-1 text-sm", on && "text-faint line-through decoration-faint")}><Radio on={on} size={16} />{t}</div>
            ))}
            <div className="flex items-center gap-2.5 px-1 py-1 text-sm text-faint"><Plus className="size-4" />Add an item</div>
          </div>
          <div className="space-y-0.5 border-t border-line pt-3">
            {FIELDS.map(({ icon: I, label, value, none, clear, bare, add }) => (
              <div key={label} className="flex min-h-9 items-center gap-3 text-sm text-dim">
                <I className="size-4" /><span className="w-20">{label}</span>{bare ? value : <Pill none={none}>{value}</Pill>}
                {clear ? <span className="flex size-6 items-center justify-center"><X className="size-3.5 text-faint" /></span> : null}
                {add ? <Pill none><Plus className="size-3.5" />Add</Pill> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </WebShell>
  );
}
