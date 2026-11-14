import { PhoneTasks, TODAY } from "@/components/mock/PhoneTasks";
import { PhoneFrame } from "@/components/ui";
import { useClock } from "../kit/clock";
import { Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import type { Shot } from "../storyboard";

/** Which of Today's tasks are ticked (their place in the list), and when. */
const TICKS: [number, number][] = [[0, 1.5], [3, 2.7]];

/** Today on the phone: two of its tasks are ticked, one after the other. */
export function Tasks({ shot }: { shot: Shot }) {
  const { after } = useClock();
  const tasks = TODAY.map((task, i) => ({ ...task, done: task.done || TICKS.some(([which, at]) => which === i && after(at)) }));
  return (
    <Split shot={shot}>
      <Enter top={70}><PhoneFrame label="Today's tasks on the phone" className="w-[600px]"><PhoneTasks tasks={tasks} /></PhoneFrame></Enter>
      {TICKS.map(([which, at]) => <Tap key={which} on={`tick ${TODAY[which]?.title}`} at={at} />)}
    </Split>
  );
}
