import { ConfirmCard, Dock, ToolLine, UserBubble } from "./parts";
import { LisbonPage } from "./WebNote";

/** The dock drawn on its own, at its own width: the chat, the card to approve, the composer. */
export const DOCK = { w: 400, h: 660 } as const;

const Chat = () => (
  <Dock sees="Autumn trip: Lisbon in five days">
    <UserBubble>What&apos;s still to book for this trip?</UserBubble>
    <ToolLine>Read 1 note · read tasks</ToolLine>
    <p className="text-[15px] leading-[1.6]">Two things in the note have no task yet: the <strong className="font-semibold">Sintra timed entry</strong> and <strong className="font-semibold">a table for the last night</strong>. Shall I add them?</p>
    <ConfirmCard title="Add 2 tasks?" why="Both are in the note and in neither list." tasks={[
      { title: "Book the Sintra timed entry", when: "Thursday", tags: ["travel"] },
      { title: "Book a table for the last night", when: "Saturday", tags: ["travel"] },
    ]} />
    <p className="text-[15px] leading-[1.6] text-dim">Both linked to this note. Nothing is written until you say so.</p>
  </Dock>
);

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
export function AskDock() {
  return <div className="flex h-full w-full bg-bg"><Chat /></div>;
}
