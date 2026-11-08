// A task's checklist: boxes to add, tick, edit and delete. Each is a change to the task's list, matched by the item's id,
// so an edit made on another device meanwhile is kept (core/todo.ts addItem, setItem, removeItem).
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { addItem, removeItem, setItem } from "@/core/todo";
import { DraftInput } from "@/components/draft-field";
import { TickBox } from "@/components/tick-box";
import { Button } from "@/components/ui/button";
import { changeTask } from "@/hooks/todo";
import { report } from "@/lib/report";
import { cn } from "@/lib/utils";
import type { TaskRec } from "@/services/todo";

const bare = "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input dark:bg-transparent";

export function Checklist({ task }: { task: TaskRec }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    setText("");
    if (t) report(changeTask(qc, task.id, (cur) => addItem(cur, t)));
  };
  return (
    <ul className="space-y-0.5" aria-label="Checklist">
      {task.checklist.map((i) => (
        <li key={i.id} className="group/item flex items-center gap-2.5">
          <TickBox size="sm" checked={i.done} aria-label={i.done ? `Untick "${i.text}"` : `Tick "${i.text}"`}
            onClick={() => report(changeTask(qc, task.id, (cur) => setItem(cur, i.id, { done: !i.done })))} />
          <DraftInput value={i.text} aria-label="Checklist item" onSave={(t) => changeTask(qc, task.id, (cur) => (t.trim() ? setItem(cur, i.id, { text: t }) : removeItem(cur, i.id)))}
            className={cn(bare, "flex-1 text-sm md:text-sm", i.done && "text-faint line-through decoration-faint")} />
          <Button variant="ghost" size="icon-sm" aria-label={`Delete "${i.text}"`} onClick={() => report(changeTask(qc, task.id, (cur) => removeItem(cur, i.id)))}
            className="size-6 shrink-0 text-faint opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 any-pointer-coarse:opacity-100"><X /></Button>
        </li>
      ))}
      <li className="flex items-center gap-2.5">
        <Plus className="size-4 shrink-0 text-faint" />
        <DraftlessInput value={text} onChange={setText} onSubmit={add} />
      </li>
    </ul>
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
