import { AssistantComposer, AssistantHeader, ChatNote, PhoneShell, TaskRow, ToolLine, UNDER_TABS, UserBubble } from "./parts";

/** The Ask tab (web/src/components/assistant/dock.tsx below `md`): the assistant's panel over the whole page, above the tab bar. A
 *  short chat with the cards the agent shows, what it sees, and the composer. */
export function PhoneAsk() {
  return (
    <PhoneShell tab="Ask">
      <div className={`flex h-full flex-col ${UNDER_TABS}`}>
        <AssistantHeader phone />
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-5">
          <UserBubble>What should I cook this week, and what&apos;s left to do for Lisbon?</UserBubble>
          <ToolLine>Searched · read tasks</ToolLine>
          <ChatNote />
          <div className="overflow-hidden rounded-2xl border border-line bg-card py-0.5"><TaskRow task={{ title: "Book Sintra train tickets", due: "Wednesday" }} /></div>
          <p className="text-[15px] leading-[1.6]">Your <strong className="font-semibold">pasta e fagioli</strong> suits a cold week, and it is better on day two. For Lisbon, the most urgent task is <strong className="font-semibold">booking the Sintra train tickets</strong>.</p>
        </div>
        <AssistantComposer sees="Home" />
      </div>
    </PhoneShell>
  );
}
