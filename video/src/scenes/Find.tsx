import { FIND } from "@/components/mock/Turns";
import { Asked } from "../kit/Asked";
import type { Shot } from "../storyboard";

/** The assistant asked to find notes and act on them: the notes it found arrive as tiles, then the tasks it added. */
export const Find = ({ shot }: { shot: Shot }) =>
  <Asked shot={shot} turn={FIND} send={2.1} arrive={[2.45, 2.8, 3.9, 4.15, 4.4]} label="The assistant showing the notes it found and the tasks it added" />;
