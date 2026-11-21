// A chat's reply as the app draws it, wherever the chat is: the dock (panel.tsx), an ask about selected words (selection-ask.tsx),
// a note action's run (note-run.tsx). The agent's turns as turn.tsx draws them (cards, rows, the answer, a choice to tap), a line
// while nothing on screen moves, and a failed request with Retry. The scroller around it is the caller's: each sits differently.
import type { UseChatHelpers } from "@ai-sdk/react";
import { transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { ShimmeringText } from "@animate-ui/react/primitives/texts/shimmering";
import type { UIMessage } from "ai";
import { Loader2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { Turn } from "@/components/assistant/turn";
import { Button } from "@/components/ui/button";
import type { ChoiceOutput } from "@/core/assistant";
import { waiting } from "@/lib/ask";
import { keepFocus } from "@/lib/keys";

export type LiveChat = Pick<UseChatHelpers<UIMessage>, "messages" | "status" | "error" | "regenerate" | "addToolApprovalResponse" | "addToolOutput">;

export function ChatReply({ live, mine, working, canRetry = true }: {
  live: LiveChat;
  /** The owner's messages: as the dock's bubbles, as a quiet line over the answer (an ask's question), or not at all (a run's
   *  prompt, which the owner didn't write). */
  mine: "bubble" | "line" | "none";
  /** The line shown while a reply is on its way and nothing on screen moves yet. */
  working: string;
  /** Retry can go (false without a model). */
  canRetry?: boolean;
}) {
  const { messages, status, error, regenerate, addToolApprovalResponse, addToolOutput } = live;
  const choose = useCallback((toolCallId: string, output: ChoiceOutput) => { void addToolOutput({ tool: "ask_choice", toolCallId, output }); }, [addToolOutput]);
  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1], thinking = waiting(last, busy);
  const fade = useTempoTransition(transition.fade);
  return (
    <>
      {messages.map((m) => m.role === "user" && mine !== "bubble" ? (
        mine === "line" ? <p key={m.id} className="text-[13px] font-medium text-dim">{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</p> : null
      ) : (
        <Turn key={m.id} m={m} streaming={status === "streaming" && m === last} live={busy && m === last} last={m === last} respond={addToolApprovalResponse} choose={choose} />
      ))}
      {/* Its box follows its content, so the line opens and closes the space it takes instead of blinking in and out */}
      <AutoHeight aria-hidden={!thinking} deps={[thinking]}>
        <AnimatePresence initial={false}>
          {thinking ? (
            <motion.p key="thinking" className="flex items-center gap-2 text-sm text-dim"
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>
              <Loader2 className="size-4 animate-spin" /><ShimmeringText text={working} color="var(--tf-dim)" shimmeringColor="var(--tf-fg)" />
            </motion.p>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
      {error ? (
        <div role="alert" className="space-y-2 rounded-xl border border-down/40 bg-down/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-down"><TriangleAlert className="size-4" /> Request failed</p>
          <p className="break-words text-[13px] text-dim">{error.message}</p>
          <Button size="sm" variant="secondary" className="rounded-full" disabled={!canRetry} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => { void regenerate(); }}>Retry</Button>
        </div>
      ) : null}
    </>
  );
}
