import { ArrowDownUp, Hash, Plus, Tags } from "lucide-react";
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

const Ghost = ({ children, brand }: { children: React.ReactNode; brand?: boolean }) => (
  <span className={brand ? "flex size-9 items-center justify-center text-brand" : "flex size-8 items-center justify-center rounded-lg border border-line text-dim"}>{children}</span>
);

/** Home as the installed app draws it (web/src/components/home.tsx below `md`): the mark (the lens) and Search, the days strip, the
 *  task box at a fixed height, then every note in two columns. */
export function PhoneHome({ lens = "Home" }: { lens?: "Home" | "Work" }) {
  const v = LENSES[lens];
  const cols = [v.notes.filter((_, i) => i % 2 === 0), v.notes.filter((_, i) => i % 2 === 1)];
  return (
    <PhoneShell tab="Home">
      <div className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-2">
          <HomeHeader lens={lens} />
          <Days />
          <div>
            <div className="flex items-center gap-2 pl-1.5 pr-2 pb-2">
              <BoxWords phone />
              <Ghost><Hash className="size-4" /></Ghost>
              <Ghost brand><Plus className="size-[22px]" /></Ghost>
            </div>
            <div className="relative h-72 overflow-hidden">
              {v.tasks.map((t) => <TaskRow key={t.title} task={t} />)}
              {v.evening ? <><Evening phone /><TaskRow task={v.evening} /></> : null}
              <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-bg" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4">
          <b className="text-lg font-extrabold tracking-tight">Notes</b><span className="flex-1 pt-1 text-xs tabular-nums text-faint">{v.count}</span>
          <Ghost><Hash className="size-4" /></Ghost>
          <Ghost><Tags className="size-4" /></Ghost>
          <Ghost><ArrowDownUp className="size-4" /></Ghost>
          <Ghost brand><Plus className="size-[22px]" /></Ghost>
        </div>
        <div className="flex items-start gap-3 px-4 pb-4">
          {cols.map((c, i) => <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">{c.map((n) => <NoteTile key={n.title} note={n} maxTags={2} />)}</div>)}
        </div>
      </div>
    </PhoneShell>
  );
}
