// What a streamed reply's new block (a row, the answer, a card) and a message just sent come in as: a short rise and fade (the list
// recipe's entrance), only if the reply is live when the block appears — one that is there when the chat opens sits still. Decided
// once, at mount: a block going live later (a confirm card answered, the turn resumed) doesn't replay it.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";

export function Rise({ live, children }: { live: boolean; children: ReactNode }) {
  const [enter] = useState(live);
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade);
  return (
    <motion.div initial={enter ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0, transition: { ...move, opacity: fade } }}>
      {children}
    </motion.div>
  );
}
