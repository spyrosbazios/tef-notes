// A text field that saves as you type, without a write per key: the text is local while it is being edited, goes out
// after a pause, on blur, and when the field goes away. A server copy that changes meanwhile is taken in once the field
// is at rest; a write that fails puts the server's text back and says why.
import { useCallback, useEffect, useRef, useState } from "react";
import { MicButton } from "@/components/mic-button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dictateInto } from "@/hooks/dictation";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";

const IDLE = 700;

function useDraftText(value: string, save: (text: string) => Promise<unknown>) {
  const [text, setText] = useState(value);
  const dirty = useRef(false), latest = useRef(value), server = useRef(value), timer = useRef<ReturnType<typeof setTimeout>>(undefined), saver = useRef(save);
  useEffect(() => { saver.current = save; server.current = value; });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saver.current(latest.current).catch((e) => { toast.error(message(e)); if (!dirty.current) setText(server.current); });
  }, []);

  // The server's copy at rest replaces the box, but not for a difference in edge whitespace alone: a store that trims would
  // otherwise eat the space typed before a pause, mid-sentence.
  useEffect(() => { if (!dirty.current) setText((t) => (t.trim() === value.trim() ? t : value)); }, [value]);
  useEffect(() => flush, [flush]);

  const edit = (next: string) => {
    dirty.current = true;
    latest.current = next;
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, IDLE);
  };
  return { text, edit, flush };
}

type Props<E> = { value: string; onSave: (text: string) => Promise<unknown>; onKeyDown?: (e: React.KeyboardEvent<E>) => void };

export function DraftInput({ value, onSave, onKeyDown, className, ...rest }: Props<HTMLInputElement> & Omit<React.ComponentProps<"input">, "value" | "onChange" | "onBlur" | "onKeyDown">) {
  const { text, edit, flush } = useDraftText(value, onSave);
  return (
    <Input {...rest} className={className} value={text} onChange={(e) => edit(e.target.value)} onBlur={flush}
      onKeyDown={(e) => { if (e.key === "Enter") flush(); onKeyDown?.(e); }} />
  );
}

/** `dictate`: a mic in its corner (mic-button.tsx), what is said put in at the caret and saved like typing. */
export function DraftTextarea({ value, onSave, onKeyDown, className, dictate, ...rest }: Props<HTMLTextAreaElement> & { dictate?: boolean } & Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "onBlur" | "onKeyDown">) {
  const { text, edit, flush } = useDraftText(value, onSave);
  const area = useRef<HTMLTextAreaElement>(null);
  const box = <Textarea {...rest} ref={area} className={cn(className, dictate && "pr-11")} value={text} onChange={(e) => edit(e.target.value)} onBlur={flush} onKeyDown={onKeyDown} />;
  if (!dictate) return box;
  return (
    <div className="relative">
      {box}
      <MicButton className="absolute top-1 right-1" onText={(t) => { dictateInto(area.current, area.current?.value ?? text, t, edit); }} />
    </div>
  );
}
