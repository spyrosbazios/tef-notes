// What the assistant answers with besides words (web/src/components/assistant/widgets.tsx), drawn: a day's plan and a
// gallery of notes. Each is a copy in structure of the app's own widget; the tasks and notes in them are the demo's.
import { CalendarDays, LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";
import { ChatTask, NoteTile, type DemoNote, type DemoTask } from "./parts";

const Heading = ({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) => (
  <h3 className="flex items-baseline gap-2 text-[15px] font-semibold leading-snug">
    <span className="self-center text-dim">{icon}</span><span>{title}</span><span className="text-sm font-normal text-dim">{detail}</span>
  </h3>
);

const Quiet = ({ children }: { children: ReactNode }) => <p className="text-xs text-faint">{children}</p>;

/** The demo's Monday: the tasks booked at an hour, each with when it starts and ends, then the ones with no set time. */
const BOOKED: [string, string, DemoTask][] = [
  ["09:30", "10:00", { title: "Call the plumber about the radiator", tags: ["home"] }],
  ["13:00", "13:45", { title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] }],
  ["18:30", "19:00", { title: "Pack the carry-on", checklist: [2, 4] }],
];
const LOOSE: DemoTask[] = [{ title: "Water the plants", every: "Every 3 days" }];

/** `show_day`'s widget (DayView): the day and its name, each booked task beside its hours, the tasks with no set time, and
 *  what the day holds besides. */
export function DayPlan() {
  return (
    <section className="space-y-2.5">
      <Heading icon={<CalendarDays className="size-4" />} title="Today" detail="Monday" />
      <ol className="space-y-2">
        {BOOKED.map(([at, until, task]) => (
          <li key={task.title} className="flex items-start gap-2.5">
            <div className="w-11 shrink-0 pt-2.5 text-right text-xs tabular-nums leading-tight text-dim">
              <span className="block font-semibold text-fg">{at}</span><span className="block text-faint">{until}</span>
            </div>
            <div className="min-w-0 flex-1"><ChatTask task={task} /></div>
          </li>
        ))}
      </ol>
      <div className="space-y-2">
        <Quiet>No set time</Quiet>
        {LOOSE.map((task) => <ChatTask key={task.title} task={task} />)}
      </div>
      <Quiet>+2 more · 1 done</Quiet>
    </section>
  );
}

/** `show_notes`' widget (NotesView): the notes it picked as Home's tiles, in the two columns the dock's width gives them. */
export function NotesGallery({ title, notes }: { title: string; notes: DemoNote[] }) {
  const cols = [notes.filter((_, i) => i % 2 === 0), notes.filter((_, i) => i % 2 === 1)];
  return (
    <section className="space-y-2.5">
      <Heading icon={<LayoutGrid className="size-4" />} title={title} detail={`${notes.length} ${notes.length === 1 ? "note" : "notes"}`} />
      <div className="flex items-start gap-3">
        {cols.map((col, i) => <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">{col.map((n) => <NoteTile key={n.title} note={n} maxTags={2} />)}</div>)}
      </div>
    </section>
  );
}
