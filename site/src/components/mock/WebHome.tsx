import { ArrowDownUp, ChevronDown, LayoutGrid, Plus, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { BoxWords, Evening, NOTES, NoteTile, Planner, TaskRow, WebShell, type DemoTask } from "./parts";

const TODAY: DemoTask[] = [
  { title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] },
  { title: "Pack the carry-on", checklist: [2, 4] },
  { title: "Measure the spare room", note: "Garage and house maintenance" },
  { title: "Water the plants", every: "Every 3 days" },
];

const Outline = ({ children }: { children: ReactNode }) => (
  <span className="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.8rem] font-medium text-dim">{children}</span>
);

/** Home: the date, the task box beside the month planner, then every note as tiles in a masonry. The lens Home is on. */
export function WebHome() {
  const cols = [0, 1, 2].map((c) => NOTES.filter((_, i) => i % 3 === c));
  return (
    <WebShell active="home" lens="Home">
      <main className="h-full min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-[1152px] flex-col gap-12 px-8 pt-8">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight">Monday 2 November</h1>
          <div className="grid grid-cols-2 items-start gap-14">
            <section className="flex h-[416px] min-w-0 flex-col">
              <header className="flex items-center gap-3 pb-2 pl-3">
                <BoxWords />
                <span className="flex size-7 items-center justify-center rounded-lg text-brand"><Plus className="size-4" /></span>
              </header>
              <div>
                {TODAY.map((t) => <TaskRow key={t.title} task={t} />)}
                <Evening />
                <TaskRow task={{ title: "Read for twenty minutes", remind: "21:00" }} />
              </div>
            </section>
            <Planner />
          </div>
          <section>
            <div className="flex h-8 items-center gap-2 pb-3" style={{ boxSizing: "content-box" }}>
              <h2 className="text-[22px] font-bold tracking-tight">Notes</h2>
              <span className="flex-1 self-end pb-1 text-xs tabular-nums text-faint">24</span>
              <span className="flex overflow-hidden rounded-lg border border-line text-dim">
                <span className="flex h-7 min-w-7 px-1.5 items-center justify-center bg-accent text-brand"><LayoutGrid className="size-4" /></span>
                <span className="flex h-7 min-w-7 px-1.5 items-center justify-center"><Tags className="size-4" /></span>
              </span>
              <Outline><ArrowDownUp className="size-3.5" />Edited: newest<ChevronDown className="size-3.5" /></Outline>
              <span className="flex h-7 items-center gap-1.5 rounded-full bg-brand px-3 text-[0.8rem] font-medium text-bg"><Plus className="size-3.5" />New note</span>
            </div>
            <div className="grid grid-cols-3 items-start gap-3">
              {cols.map((c, i) => <div key={i} className="space-y-3">{c.map((n) => <NoteTile key={n.title} note={n} />)}</div>)}
            </div>
          </section>
        </div>
      </main>
    </WebShell>
  );
}
