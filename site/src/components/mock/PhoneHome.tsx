import { ArrowDownUp, ListFilter, Plus, Tags } from "lucide-react";
import { BoxWords, Days, Evening, HomeHeader, NOTES, NoteTile, PhoneShell, TaskRow, type DemoNote, type DemoTask } from "./parts";

type View = { tasks: DemoTask[]; evening?: DemoTask; notes: DemoNote[]; count: number };

/** What Home shows in each demo lens: the lens's tags let through its tasks and notes, nothing else. */
const LENSES: Record<"Home" | "Work", View> = {
  Home: {
    tasks: [
      { title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] },
      { title: "Measure the spare room" },
      { title: "Water the plants", every: "Every 3 days" },
    ],
    evening: { title: "Read for twenty minutes", remind: "21:00" },
    notes: [NOTES[0]!, NOTES[3]!, NOTES[1]!, NOTES[5]!],
    count: 24,
  },
  Work: {
    tasks: [
      { title: "Draft the quarterly review", due: "Friday", tags: ["work"] },
      { title: "Reply to the design feedback", checklist: [1, 3] },
      { title: "Book a room for Thursday's planning", tags: ["work"] },
      { title: "Read the onboarding notes", tags: ["reading"] },
    ],
    notes: [
      NOTES[2]!,
      { title: "Planning, week 45", tags: ["work"], age: "1h", snippet: "Budget draft first, then the client deck. Ask facilities about the projector in room 4." },
      { title: "Whiteboard from Tuesday", tags: ["work"], age: "1d", pics: ["doc"] },
      { title: "Hiring loop", color: "green", tags: ["work"], age: "3d", snippet: "Two calls left. Ask both about the last thing they deleted." },
    ],
    count: 9,
  },
};

/** Home: the mark (the lens), Search in the corner, the days strip, the task box, then every note in two columns. */
export function PhoneHome({ lens = "Home" }: { lens?: "Home" | "Work" }) {
  const v = LENSES[lens];
  const cols = [v.notes.filter((_, i) => i % 2 === 0), v.notes.filter((_, i) => i % 2 === 1)];
  return (
    <PhoneShell tab="Home">
      <div className="flex flex-col gap-2 pt-2">
        <HomeHeader lens={lens} />
        <Days />
        <div>
          <div className="mx-4 flex items-center gap-2">
            <BoxWords phone />
            <span className="flex h-8 items-center rounded-full border border-line px-2 text-dim"><ListFilter className="size-3.5" /></span>
            <span className="flex size-9 items-center justify-center text-brand"><Plus className="size-[22px]" /></span>
          </div>
          <div className="relative mt-1 h-[288px] overflow-hidden">
            {v.tasks.map((t) => <TaskRow key={t.title} phone task={t} />)}
            {v.evening ? <><Evening phone /><TaskRow phone task={v.evening} /></> : null}
            <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-bg" />
          </div>
        </div>
        <div className="mx-4 flex items-center gap-2 text-dim">
          <b className="text-[18px] font-bold text-fg">Notes</b><span className="flex-1 text-[13px] tabular-nums text-faint">{v.count}</span>
          <span className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-fg"><ListFilter className="size-3.5 text-dim" />All</span>
          <span className="flex size-9 items-center justify-center"><Tags className="size-5" /></span>
          <span className="flex size-9 items-center justify-center"><ArrowDownUp className="size-5" /></span>
          <span className="flex size-9 items-center justify-center text-brand"><Plus className="size-[22px]" /></span>
        </div>
        <div className="flex gap-2 px-3 pb-4">
          {cols.map((c, i) => <div key={i} className="flex min-w-0 flex-1 flex-col gap-2">{c.map((n) => <NoteTile key={n.title} note={n} phone />)}</div>)}
        </div>
      </div>
    </PhoneShell>
  );
}
