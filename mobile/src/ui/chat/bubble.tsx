// A message as a bubble. The user's sits on the right in the brand colour, an assistant's on the left, raised; the
// corner nearest the speaker is squared. `animate`: it has just been sent, so it rises into place (read once, at mount:
// a chat opened from history sits still).
import type { ReactNode } from "react";
import Animated, { FadeInDown } from "react-native-reanimated";
import { cn, T } from "../ds";

export function MessageBubble({ align, text, animate = false }: { align: "start" | "end"; text: string; animate?: boolean }) {
  const mine = align === "end";
  return (
    <Animated.View entering={animate ? FadeInDown.duration(220) : undefined}
      className={cn("max-w-[85%] rounded-3xl px-4 py-3", mine ? "self-end rounded-br-lg bg-brand" : "self-start rounded-bl-lg bg-muted")}>
      <T tone={mine ? "bg" : "fg"} size={15} className="leading-[22px]" selectable>{text}</T>
    </Animated.View>
  );
}

/** What a streamed reply's new block (a tool row, the answer, a card) comes in as: a short rise and fade, only while the
 *  reply is live — a block that is there when the chat opens appears at once. Read once, at mount. */
export function Appear({ live, children }: { live: boolean; children: ReactNode }) {
  return <Animated.View entering={live ? FadeInDown.duration(200) : undefined}>{children}</Animated.View>;
}
