import { History, Sparkles, SquarePen } from "lucide-react";
import { ChatNote, PhoneComposer, PhoneShell, TaskRow, ToolLine, UserBubble } from "./parts";

/** The Ask tab: a short chat with the cards the agent shows, and the composer with its microphone. */
export function PhoneAsk() {
  return (
    <PhoneShell tab="Ask">
      <div className="flex h-14 items-center gap-1 px-2 text-dim">
        <span className="flex-1 px-3 text-[18px] font-semibold text-fg">Ask</span>
        <span className="flex size-12 items-center justify-center"><Sparkles className="size-[22px]" /></span>
        <span className="flex size-12 items-center justify-center"><History className="size-[22px]" /></span>
        <span className="flex size-12 items-center justify-center"><SquarePen className="size-[22px]" /></span>
      </div>
      <div className="space-y-4 px-4 pt-2">
        <UserBubble phone>What should I cook this week, and what&apos;s left to do for Lisbon?</UserBubble>
        <ToolLine>Searched · read tasks</ToolLine>
        <ChatNote />
        <div className="overflow-hidden rounded-2xl border border-line bg-card py-0.5"><TaskRow task={{ title: "Book Sintra train tickets", due: "Wednesday" }} /></div>
        <p className="text-[15px] leading-[22px]">Your <strong className="font-bold">pasta e fagioli</strong> suits a cold week, and it is better on day two. For Lisbon, the most urgent task is <strong className="font-bold">booking the Sintra train tickets</strong>.</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-bg px-3 pb-2 pt-1"><PhoneComposer placeholder="Ask, or say what to note" /></div>
    </PhoneShell>
  );
}
