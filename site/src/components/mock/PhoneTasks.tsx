import { Plus } from "lucide-react";
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

/** The Tasks tab on Today: its lists as a pager, the day's tasks, This Evening, the + at the corner. */
export function PhoneTasks() {
  return (
    <PhoneShell tab="Tasks">
      <div className="px-5 pb-2 pt-1">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight">Today</h1>
        <p className="text-[14px] text-dim">Monday, November 2</p>
      </div>
      <div className="flex gap-1 border-b border-line px-4">
        {["Inbox", "Today", "Upcoming", "Logbook"].map((t) => (
          <span key={t} className={cn("flex h-12 items-center border-b-2 px-3 text-[15px]", t === "Today" ? "border-brand font-semibold text-fg" : "border-transparent font-medium text-dim")}>{t}</span>
        ))}
      </div>
      <div className="pt-2">
        {TODAY.map((t) => <TaskRow key={t.title} phone task={t} />)}
        <Evening phone />
        <TaskRow phone task={{ title: "Read for twenty minutes", remind: "21:00" }} />
      </div>
      <span className="absolute bottom-4 right-4 flex size-14 items-center justify-center rounded-[18px] bg-brand text-bg shadow-lift"><Plus className="size-6" /></span>
    </PhoneShell>
  );
}
