import { Plus, Star } from "lucide-react";
import { cn } from "@/lib";
import { Evening, PhoneShell, TaskRow, type DemoTask } from "./parts";

const TODAY: DemoTask[] = [
  { title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] },
  { title: "Pack the carry-on", checklist: [2, 4] },
  { title: "Measure the spare room", note: "Garage and house maintenance" },
  { title: "Water the plants", every: "Every 3 days" },
  { title: "Call the plumber about the radiator", due: "Tuesday", tags: ["home"] },
  { title: "Take out the recycling", done: true },
];

const LISTS: [string, number?][] = [["Inbox", 3], ["Today", 7], ["Upcoming"], ["Logbook"]];

/** The Tasks tab on Today (web/src/components/task-list.tsx below `md`): the list's title and date, the + beside them, the lists as
 *  tabs under a gliding line, the day's tasks and This Evening. */
export function PhoneTasks() {
  return (
    <PhoneShell tab="Tasks">
      <div className="flex items-start justify-between px-4 pb-2 pt-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight"><Star className="size-5 text-brand" />Today</h1>
          <p className="pl-7 text-sm text-dim">Monday, November 2</p>
        </div>
        <span className="mt-0.5 flex size-8 items-center justify-center text-dim"><Plus className="size-4" /></span>
      </div>
      <div className="flex gap-1 border-b border-line px-3">
        {LISTS.map(([t, n]) => (
          <span key={t} className={cn("-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold", t === "Today" ? "border-brand text-fg" : "border-transparent text-dim")}>
            {t}{n ? <span className="text-xs font-normal tabular-nums text-faint">{n}</span> : null}
          </span>
        ))}
      </div>
      <div className="px-2 pt-2">
        {TODAY.map((t) => <TaskRow key={t.title} task={t} />)}
        <Evening phone />
        <TaskRow task={{ title: "Read for twenty minutes", remind: "21:00" }} />
      </div>
    </PhoneShell>
  );
}
