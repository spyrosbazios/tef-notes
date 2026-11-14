import { DAY } from "@/components/mock/Turns";
import { Asked } from "../kit/Asked";
import type { Shot } from "../storyboard";

/** The assistant asked about the day: it reads the tasks and answers with the day's plan, then a line about it. */
export const Day = ({ shot }: { shot: Shot }) =>
  <Asked shot={shot} turn={DAY} send={1.5} arrive={[1.85, 2.2, 3.8]} label="The assistant answering with the day's plan" />;
