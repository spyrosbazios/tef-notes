// Two turns with the assistant: the page it is asked from (what the dock says it sees), what the owner asks, and the reply
// a piece at a time, in the order the pieces arrive (the first piece is the question's own bubble). The promo film plays them in the dock (video/src/scenes/Day.tsx, Find.tsx);
// the step lines are worded as core/agent.ts `gist` words them.
import type { ReactNode } from "react";
import { ChatTask, NOTES, ToolLine, UserBubble } from "./parts";
import { DayPlan, NotesGallery } from "./Widgets";

export type Turn = { sees: string; ask: string; pieces: ReactNode[] };

const turn = (sees: string, ask: string, reply: ReactNode[]): Turn => ({ sees, ask, pieces: [<UserBubble key="ask">{ask}</UserBubble>, ...reply] });

/** The day, asked for: the assistant reads the tasks and answers with the day's plan. */
export const DAY = turn("Home", "What does my day look like?", [
  <ToolLine key="steps">Read tasks</ToolLine>,
  <DayPlan key="plan" />,
  <p key="say" className="text-[15px] leading-[1.6]">Three have a set time, the plumber first. The <strong className="font-semibold">Sintra tickets</strong> are due on Wednesday.</p>,
]);

/** Notes found and acted on: the assistant searches, shows the notes it found as tiles, and adds the tasks they were missing. */
export const FIND = turn("Home", "Find my Lisbon notes and add what's left to book", [
  <ToolLine key="found">Searched · read 2 notes</ToolLine>,
  <NotesGallery key="notes" title="Lisbon" notes={[
    NOTES[1]!,
    { title: "Where to eat, 2026", color: "orange", tags: ["travel", "cooking"], age: "2d", snippet: "Ten tascas worth the queue. Go before 19:30, cash at three of them." },
  ]} />,
  <ToolLine key="added">Changed 2 tasks</ToolLine>,
  <ChatTask key="entry" task={{ title: "Book the Sintra timed entry", when: "Thursday", tags: ["travel"] }} />,
  <ChatTask key="table" task={{ title: "Book a table for the last night", when: "Saturday", tags: ["travel"] }} />,
]);
