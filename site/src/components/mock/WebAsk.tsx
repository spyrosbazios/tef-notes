import type { ReactNode } from "react";
import { ConfirmCard, Dock, ToolLine, UserBubble } from "./parts";
import { LisbonPage } from "./WebNote";

/** The dock drawn on its own, at its own width and tall enough for the page's turn whole: the chat, the card to approve,
 *  the composer. */
export const DOCK = { w: 400, h: 690 } as const;

/** The turn the page shows: the question, the steps, the answer, the card to approve, the line after it. */
const TURN: ReactNode[] = [
  <UserBubble key="ask">What&apos;s still to book for this trip?</UserBubble>,
  <ToolLine key="steps">Read 1 note · read tasks</ToolLine>,
  <p key="answer" className="text-[15px] leading-[1.6]">Two things in the note have no task yet: the <strong className="font-semibold">Sintra timed entry</strong> and <strong className="font-semibold">a table for the last night</strong>. Shall I add them?</p>,
  <ConfirmCard key="card" title="Add 2 tasks?" why="Both are in the note and in neither list." tasks={[
    { title: "Book the Sintra timed entry", when: "Thursday", tags: ["travel"] },
    { title: "Book a table for the last night", when: "Saturday", tags: ["travel"] },
  ]} />,
  <p key="after" className="text-[15px] leading-[1.6] text-dim">Both linked to this note. Nothing is written until you say so.</p>,
];

/** The chat in the dock: the page's turn, asked beside the Lisbon note, unless `turn` gives another and `sees` the page it
 *  is asked from (Turns.tsx has the ones the promo film plays, a piece at a time), and a `draft` in the composer if one is
 *  being typed. */
type ChatProps = { turn?: ReactNode; sees?: string; draft?: string };

const Chat = ({ turn = TURN, sees = "Autumn trip: Lisbon in five days", draft }: ChatProps) => <Dock sees={sees} draft={draft}>{turn}</Dock>;

/** The assistant docked beside the open note: it sees the note, reads it, and proposes the tasks as a card to approve. */
export function WebAsk() {
  return (
    <div className="flex h-full w-full bg-bg">
      <LisbonPage narrow />
      <Chat />
    </div>
  );
}

/** The dock alone, filling a DOCK-sized screen. */
export function AskDock(chat: ChatProps) {
  return <div className="flex h-full w-full bg-bg"><Chat {...chat} /></div>;
}
