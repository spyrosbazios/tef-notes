import { GUESSED, PhoneNewTask, TASK } from "@/components/mock/NewTask";
import { PhoneFrame } from "@/components/ui";
import { useClock } from "../kit/clock";
import { Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import type { Shot } from "../storyboard";

/** When each guessed tag lands, and when the task is added. */
const LAND = [2, 2.45], ADD = 3.6;

/** New task on the phone: the title is typed, the tags the server guesses for it land one after the other, and it is
 *  added. The phone hangs from above the frame, so the sheet at its foot is what shows. */
export function NewTask({ shot }: { shot: Shot }) {
  const { typed, after } = useClock();
  return (
    <Split shot={shot}>
      <Enter top={-290}>
        <PhoneFrame label="A new task on the phone, its tags guessed as it is typed" className="w-[600px]">
          <PhoneNewTask title={typed(TASK, 0.7)} tags={GUESSED.filter((_, i) => after(LAND[i] ?? ADD))} />
        </PhoneFrame>
      </Enter>
      <Tap on="add" at={ADD} />
    </Split>
  );
}
