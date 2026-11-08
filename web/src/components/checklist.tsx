// A task's checklist: boxes to add, tick, edit and delete. Each is a change to the task's list, matched by the item's id,
// so an edit made on another device meanwhile is kept (core/todo.ts addItem, setItem, removeItem). The items are a list that stays the
// same list (Animate UI's list recipe): one added rises in, one removed fades out of the flow and the rest close the gap.
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { addItem, removeItem, setItem } from "@/core/todo";
import { DraftInput } from "@/components/draft-field";
import { TickBox } from "@/components/tick-box";
import { Button } from "@/components/ui/button";
import { useLeaving } from "@/hooks/presence";
import { changeTask } from "@/hooks/todo";
import { report } from "@/lib/report";
import { cn } from "@/lib/utils";
import type { TaskRec } from "@/services/todo";

const bare = "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input dark:bg-transparent";

export function Checklist({ task }: { task: TaskRec }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const move = useTempoTransition(spring.reflow);
  const add = () => {
    const t = text.trim();
    setText("");
    if (t) report(changeTask(qc, task.id, (cur) => addItem(cur, t)));
  };
  return (
    <ul className="relative flex flex-col gap-0.5" aria-label="Checklist">
      <AnimatePresence mode="popLayout" initial={false}>
        {task.checklist.map((i) => (
          <Row key={i.id}>
            <TickBox size="sm" checked={i.done} aria-label={i.done ? `Untick "${i.text}"` : `Tick "${i.text}"`}
              onClick={() => report(changeTask(qc, task.id, (cur) => setItem(cur, i.id, { done: !i.done })))} />
            <DraftInput value={i.text} aria-label="Checklist item" onSave={(t) => changeTask(qc, task.id, (cur) => (t.trim() ? setItem(cur, i.id, { text: t }) : removeItem(cur, i.id)))}
              className={cn(bare, "flex-1 text-sm md:text-sm", i.done && "text-faint line-through decoration-faint")} />
            <Button variant="ghost" size="icon-sm" aria-label={`Delete "${i.text}"`} onClick={() => report(changeTask(qc, task.id, (cur) => removeItem(cur, i.id)))}
              className="size-6 shrink-0 text-faint opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 any-pointer-coarse:opacity-100"><X /></Button>
          </Row>
        ))}
      </AnimatePresence>
      <motion.li layout="position" transition={move} className="flex items-center gap-2.5">
        <Plus className="size-4 shrink-0 text-faint" />
        <DraftlessInput value={text} onChange={setText} onSubmit={add} />
      </motion.li>
    </ul>
  );
}

/** One item: rises in, fades out of the flow when it goes (then out of the tab order, its focus handed to the item beside it). */
function Row({ children }: { children: ReactNode }) {
  const li = useLeaving<HTMLLIElement>("[aria-label=Checklist]");
  const move = useTempoTransition(spring.reflow), fade = useTempoTransition(transition.fade);
  return (
    <motion.li ref={li} layout="position" transition={move} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { ...move, opacity: fade } }}
      exit={{ opacity: 0, scale: 0.96, transition: fade }} className="group/item flex items-center gap-2.5">
      {children}
    </motion.li>
  );
}

/** The add line: Enter adds an item and stays for the next; leaving the field with text adds it too. */
function DraftlessInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Add an item" aria-label="Add a checklist item" onBlur={onSubmit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }}
      className="h-7 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-faint" />
  );
}
