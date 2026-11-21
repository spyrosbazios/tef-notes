// A text field that saves as you type (hooks/draft.ts `useDraftText`, over the one draft primitive, lib/drafts.ts): the text is
// the box's while it is being edited, goes out after a pause, on blur, and when the field goes away. What is kept that changes
// meanwhile is taken in once the field is at rest; a write that fails keeps what was typed, says why, and goes again with the
// next key or blur.
import { useRef } from "react";
import { MicButton } from "@/components/mic-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDraftText } from "@/hooks/draft";
import { dictateInto } from "@/hooks/dictation";
import { cn } from "@/lib/utils";

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
