// Talk in a small panel at a window's corner, where the assistant's button sits (fab.tsx, when the owner's `desktop.fab` asks for
// Talk): the Talk page's own conversation drawn as a phone draws it (page.tsx `Conversation` with `panel`). Opening it starts a
// conversation unless one is on. Close leaves the conversation going (the pill takes over), Expand goes to Talk's page. Not on
// Talk's page, which is all of this, nor on a phone, where Talk is a tab.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import { Conversation } from "@/components/talk/page";
import { setTalkPanel, useTalkPanel } from "@/lib/talk-panel";
import { useNav, usePlace } from "@/lib/nav";

export function TalkPanel() {
  const open = useTalkPanel();
  const { view } = usePlace();
  const { goView } = useNav();
  const pop = useTempoTransition(spring.pop), away = useTempoTransition(transition.dismiss);
  const shown = open && view.kind !== "talk";
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div key="talk-panel" role="dialog" aria-label="Talk"
          initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: pop }} exit={{ opacity: 0, y: 16, scale: 0.96, transition: away }}
          style={{ transformOrigin: "bottom right" }}
          className="fixed right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-[min(40rem,calc(100dvh-2.5rem))] w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-2xl max-md:hidden">
          <Conversation panel={{ onClose: () => setTalkPanel(false), onExpand: () => { setTalkPanel(false); goView({ kind: "talk" }); } }} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
