// What has been said and done, as Talk shows it: the words of both sides as large captions, the newest at full strength and each older one
// a step quieter, and between them what the assistant did, drawn by the Ask panel's own `Turn` (a note opened, a widget, a
// card, a finished confirm). The assistant's words sit left and the owner's right, so a caption says who without a label. What waits
// for the owner's tap is not here but in the tray (`Tray`), where it stays in reach. The scroller follows the newest line unless the
// owner scrolled up to read (hooks/stick.ts).
import { ScrollFade } from "@animate-ui/react/primitives/effects/scroll-fade";
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo, type ReactNode } from "react";
import { Rise } from "@/components/assistant/rise";
import { Turn } from "@/components/assistant/turn";
import type { ChoiceOutput } from "@/core/assistant";
import { useStick } from "@/hooks/stick";
import type { Row, TalkState } from "@/lib/talk";
import { talkScroll } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { useTalk } from "@/hooks/talk";
import type { ToolPart } from "@/lib/ask";

/** How much of its strength a caption keeps, by how many captions came after it. */
const STRENGTH = [1, 0.62, 0.4, 0.26];

/** Words said. A caption never changes size as it recedes (it would reflow what is read), only how loud it is. */
const Said = memo(function Said({ who, text, age }: { who: "you" | "assistant"; text: string; age: number }) {
  return (
    <p style={{ opacity: STRENGTH[Math.min(age, STRENGTH.length - 1)] }}
      className={cn("text-balance break-words text-xl leading-snug font-medium transition-opacity duration-300 ease-out motion-reduce:transition-none md:text-2xl",
        who === "you" ? "ml-auto max-w-[85%] text-right text-dim" : "mr-auto max-w-[92%] text-fg")}>
      {text}
    </p>
  );
});

/** What the Ask panel's `Turn` is handed to answer with: nothing in the transcript is answerable (a card that waits is the tray's). */
const noop = (): void => {};

type Props = {
  rows: Row[]; live: boolean; state: TalkState;
  /** The newest message's id: its run of doings is the one still moving while the conversation is live. */
  newest: string | undefined;
  /** What stands in for the rows before there are any. */
  empty: ReactNode;
};

export function Transcript({ rows, live, state, newest, empty }: Props) {
  const { el, onScroll } = useStick<HTMLDivElement>(rows, state);
  // A caption's age: the captions after it
  const ages = new Map<string, number>();
  let after = 0;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === "said") ages.set(rows[i].key, after++);

  const show = (r: Row) => r.kind === "said"
    ? <Said who={r.who} text={r.text} age={ages.get(r.key) ?? 0} />
    : <Turn m={r.message} streaming={false} live={live && r.message.id.startsWith(`${newest}:`)} last={r.last} respond={noop} choose={noop} />;

  return (
    <ScrollFade asChild size={40} shrink={0} blur={0}>
      <div ref={el} onScroll={onScroll} data-scroll-restoration-id={talkScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-end gap-4 px-5 py-6">
          {rows.length ? rows.map((r) => (r.kind === "said" ? <Rise key={r.key} live={live}>{show(r)}</Rise> : <div key={r.key}>{show(r)}</div>)) : <div className="my-auto">{empty}</div>}
        </div>
      </div>
    </ScrollFade>
  );
}

/** What waits for the owner's tap (a confirm card, an `ask_choice`'s buttons), under the transcript and above the controls, on the
 *  Ask panel's own `Turn`. Its box follows its content, so it opens and closes its space instead of blinking in and out. */
export function Tray({ pending, last }: { pending: ToolPart[]; last: UIMessage | undefined }) {
  const { session } = useTalk();
  const move = useTempoTransition(spring.pop), fade = useTempoTransition(transition.fade);
  const message = useMemo<UIMessage | null>(() => (last && pending.length ? { id: `${last.id}:ask`, role: "assistant", parts: pending } : null), [last, pending]);
  const respond: ChatAddToolApproveResponseFunction = (r) => session.approve(r.id, r.approved, r.reason);
  const choose = (toolCallId: string, output: ChoiceOutput) => session.choose(toolCallId, output);
  return (
    <AutoHeight aria-live="polite" deps={[!!message]}>
      <AnimatePresence initial={false}>
        {message ? (
          <motion.div key="tray" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: { ...move, opacity: fade } }} exit={{ opacity: 0, y: 8, transition: fade }}
            className="mx-auto max-h-[min(55dvh,28rem)] w-full max-w-2xl overflow-y-auto px-4 pb-3 md:pb-20">
            <Turn m={message} streaming={false} live={false} last respond={respond} choose={choose} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </AutoHeight>
  );
}
