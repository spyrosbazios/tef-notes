// Messages typed while a reply runs: they wait here, in order, and the panel sends the first once the turn is over (not while
// a card or a choice waits on the owner, and not after Stop or an error: then the owner resumes). Local to the open chat's
// panel, never sent to the server until its turn: switching chats drops it. "Send now" steers the running reply instead
// (services/agent.ts `steer`): the agent reads it at its next step; if the reply ends first, it stays queued.
import { askedAbout } from "@/core/handoff";
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import type { FileUIPart } from "ai";
import { CornerDownRight, Loader2, Paperclip, Pencil, Play, SendHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";

export type Queued = { id: number; text: string; files: FileUIPart[] };

export function Queue({ items, paused, live, sending, onEdit, onRemove, onResume, onSteer }: {
  items: Queued[]; paused: boolean;
  /** A reply is running, so a message can be steered into it (text only: steering carries no files). */
  live: boolean; sending: ReadonlySet<number>;
  onEdit: (q: Queued) => void; onRemove: (id: number) => void; onResume: () => void; onSteer: (q: Queued) => void;
}) {
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade);
  return (
    <AnimatePresence initial={false}>
      {items.length ? (
        <motion.div key="queue" className="overflow-hidden" initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { ...move, opacity: fade } }} exit={{ height: 0, opacity: 0, transition: fade }}>
          <div className="flex items-center gap-2 px-1 pb-1 text-xs text-faint">
            <span className="flex-1">{paused ? "Queued, paused" : "Queued, sent when the reply ends"}</span>
            {paused ? <Button variant="ghost" size="xs" className="rounded-full" onClick={onResume}><Play />Resume</Button> : null}
          </div>
          <ul className="space-y-1 pb-2" aria-label="Queued messages">
            <AnimatePresence initial={false}>
              {items.map((q) => (
                <motion.li key={q.id} layout="position" className="flex items-center gap-2 rounded-xl border border-line bg-raised py-1 pr-1 pl-3 text-sm"
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { ...move, opacity: fade } }} exit={{ opacity: 0, transition: fade }}>
                  <CornerDownRight className="size-3.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{askedAbout(q.text).rest || askedAbout(q.text).notes[0]?.title || q.files[0]?.filename || "Attachment"}</span>
                  {q.files.length ? <span className="flex shrink-0 items-center gap-0.5 text-xs text-dim"><Paperclip className="size-3" />{q.files.length}</span> : null}
                  {sending.has(q.id) ? <Loader2 className="mx-1.5 size-4 shrink-0 animate-spin text-dim" aria-label="Sending into the reply" /> : (
                    <>
                      {live && q.text && !q.files.length ? (
                        <Button variant="ghost" size="icon-sm" className="shrink-0 text-dim" aria-label="Send now, into the reply" title="Send now: the assistant reads it at its next step"
                          onClick={() => onSteer(q)}><SendHorizontal /></Button>
                      ) : null}
                      <Button variant="ghost" size="icon-sm" className="shrink-0 text-dim" aria-label="Edit" onClick={() => onEdit(q)}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" className="shrink-0 text-dim" aria-label="Remove from queue" onClick={() => onRemove(q.id)}><X /></Button>
                    </>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
