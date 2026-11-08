// The assistant's question (`ask_choice`, core/assistant.ts): buttons drawn from the call's input, answered by the owner, which
// resumes the turn. Only the newest turn can still be answered; an older one was passed over. Answered, it is a line saying what was chosen.
import { Button as Press } from "@animate-ui/react/primitives/buttons/button";
import { scale } from "@animate-ui/react/utils/motion";
import { Check, MessageCircleQuestion, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTouch } from "@/hooks/media";
import { choiceFrom, choiceOutput, chosenOf, type ChoiceOutput, type UiToolInput } from "@/core/assistant";
import type { ToolPart } from "@/lib/ask";
import { cn } from "@/lib/utils";

type Question = UiToolInput["ask_choice"];

/** A quiet line: the question, and how it ended. */
function Line({ question, end }: { question: string; end: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5 text-sm text-dim">
      <MessageCircleQuestion className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{question}<span className="text-fg"> · {end}</span></span>
    </div>
  );
}

function Ask({ q, disabled, onAnswer }: { q: Question; disabled: boolean; onAnswer: (o: ChoiceOutput) => void }) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  // An option is a whole row: a mouse presses it to `scale.choice` on `spring.press` (Animate UI's Button); under a finger every button
  // already scales to .97 from one CSS rule (index.css), so the press is left to it rather than doubled
  const tap = useTouch() ? 1 : scale.choice;
  const toggle = (id: string) => setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div role="group" aria-label={q.question} className="space-y-2.5 rounded-2xl border border-line bg-card p-3">
      <p className="flex items-start gap-2 text-[15px] font-medium leading-snug">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-brand" />
        <span className="min-w-0 break-words">{q.question}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {q.options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <Press key={o.id} asChild tapScale={tap}>
              <Button type="button" variant={on ? "secondary" : "outline"} disabled={disabled} aria-pressed={q.multi ? on : undefined}
                onClick={() => (q.multi ? toggle(o.id) : onAnswer(choiceOutput([o.id])))}
                className={cn("h-auto justify-start gap-2 whitespace-normal rounded-xl px-3 py-2 text-left", on && "border-brand")}>
                {q.multi ? <Check className={cn("size-4 shrink-0", on ? "text-brand" : "text-transparent")} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{o.label}</span>
                  {o.hint ? <span className="block text-xs font-normal text-dim">{o.hint}</span> : null}
                </span>
              </Button>
            </Press>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="rounded-full text-dim" disabled={disabled}
          onClick={() => onAnswer({ error: "The owner dismissed the question." })}>Skip</Button>
        {q.multi ? (
          <Button type="button" size="sm" className="rounded-full" disabled={disabled || !picked.length} onClick={() => onAnswer(choiceOutput(picked))}>
            <Send /> Send
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type Props = { p: ToolPart; last: boolean; live: boolean; answer: (toolCallId: string, output: ChoiceOutput) => void };

/** One `ask_choice` call: buttons while it waits in the newest turn, else a line. */
export function Choice({ p, last, live, answer }: Props) {
  const q = choiceFrom(p.input);
  if (!q) return null;                                                      // still streaming; a call that can never be shown is answered with an error by the provider
  if (p.state === "output-available") {
    const ids = chosenOf(p.output), labels = ids?.map((id) => q.options.find((o) => o.id === id)?.label ?? id);
    return <Line question={q.question} end={labels?.length ? labels.join(", ") : "Skipped"} />;
  }
  if (p.state !== "input-available") return <Line question={q.question} end="Not answered" />;
  if (!last) return <Line question={q.question} end="Passed over" />;
  return <Ask q={q} disabled={live} onAnswer={(o) => answer(p.toolCallId, o)} />;
}
