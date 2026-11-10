// One message of the assistant's chat. The user's: a bubble. The agent's: its thoughts, tool calls and answer in the order they
// came. A tool call is a row, a note write a confirm card, the answer streaming markdown. Consecutive finished
// thoughts and read-only calls fold into one summary line; what is still moving, failed, or left a card to open stays a row.
import { CopyButton, CopyButtonIcon } from "@animate-ui/react/primitives/buttons/copy";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { ArrowUpRight, Check, ChevronDown, Copy, FileText, ListChecks, Loader2, TriangleAlert } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import remend from "remend";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cardsByPart, flagLine, gist, kindOf, label, UNCONFIRMED, type Kind, type WriteInput } from "@/core/agent";
import { plainShared } from "@/core/share";
import { isAskTool, type ChoiceOutput } from "@/core/assistant";
import { isWidgetTool, widgetOf } from "@/core/widgets";
import { useNotes } from "@/hooks/notes";
import { useTasks } from "@/hooks/todo";
import { isAppTool, uiTrouble, uiWords, type AppTool } from "@/lib/assistant";
import { DrawRow } from "@/components/assistant/drawing";
import { isTool, toolName, type Part, type ToolPart } from "@/lib/ask";
import { cn } from "@/lib/utils";
import { Cards } from "./cards";
import { Choice } from "./choice";
import { Confirm } from "./confirm";
import { Rise } from "./rise";
import { WidgetView } from "./widgets";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The line beside a tool's name: what it looked for, which note, or the agent's why. */
function detailOf(name: string, i: Record<string, unknown>, titleOf: (path: unknown) => string): string {
  switch (name) {
    case "search_notes": case "web_search": case "find_place": return str(i.query);
    case "set_place": return ["a task", i.clear ? "no place" : str(i.name) || "a place from Maps"].join(" · ");
    case "list_notes": return str(i.filter);
    case "list_tagged": return Array.isArray(i.tags) ? i.tags.map(str).join(i.match === "all" ? " + " : " · ") : "";
    case "read_note": case "append_to_note": case "summarise_links": case "delete_note": return titleOf(i.path);
    case "create_lens": return str(i.name);
    case "create_tag": case "update_tag": return str(i.name) || str(i.id);
    case "create_note": return str(i.title);
    case "attach_file": return [str(i.file), i.path ? titleOf(i.path) : str(i.title)].filter(Boolean).join(" · ");
    case "rewrite_note": return str(i.why) || titleOf(i.path);
    case "set_note_flags": return `${titleOf(i.path)} · ${flagLine(i as WriteInput, true)}`;
    case "add_task": return str(i.title);
    case "update_task": case "complete_task": case "delete_task": return str(i.about);
    case "list_tasks": return [str(i.view), str(i.query), str(i.tag)].filter(Boolean).join(" · ");
    case "update_memory": return str(i.why);
    case "show_items": return "";
    case "read_url": return Array.isArray(i.urls) ? i.urls.join(", ") : str(i.url);
    default: return "";
  }
}

const settledState = (p: ToolPart) => p.state === "output-available" || p.state === "output-error" || p.state === "output-denied";
const answered = (p: ToolPart) => p.state === "approval-requested" || p.state === "approval-responded";

/** Animate UI's Copy Button: the icon swaps for a check (and back after a moment) in place, through a light blur. It is its own press
 *  element, dressed in the ghost icon button's classes. */
function CopyAnswer({ text }: { text: string }) {
  return (
    <CopyButton type="button" content={text} delay={1500} aria-label="Copy answer"
      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-ml-1.5 text-dim any-pointer-coarse:min-h-10 any-pointer-coarse:min-w-10")}>
      <CopyButtonIcon icon={<Copy className="size-4" />} copiedIcon={<Check className="size-4 text-brand" />} />
    </CopyButton>
  );
}

/** A thought or a summary: a line that opens to show what is in it. */
function Fold({ icon, title, busy, defaultOpen, children }: { icon: ReactNode; title: string; busy?: boolean; defaultOpen?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-0.5 text-left text-sm text-dim hover:text-fg">
        {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {children ? <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} /> : null}
      </CollapsibleTrigger>
      {children ? (
        <CollapsibleContent className="overflow-hidden">
          <div className="ml-2 mt-1.5 space-y-2 border-l border-line pl-4">{children}</div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

/** The parts of a message worth a row: a run of reasoning parts is one thought, kept at its first index (`i`..`end`). */
type Step = { i: number; end: number };
function stepsOf(parts: Part[]) {
  const steps: Step[] = [];
  parts.forEach((p, i) => {
    if (p.type === "reasoning" && parts[i - 1]?.type === "reasoning") steps[steps.length - 1].end = i;
    else if (p.type === "reasoning" || p.type === "text" || p.type === "steering-message" || isTool(p)) steps.push({ i, end: i });
  });
  return steps;
}

/** A UI tool call as one line: "Opened note “Garage”", or why the app could not. `title`: the record's, if the app has it. */
function UiRow({ name, p, title }: { name: AppTool; p: ToolPart; title: string | undefined }) {
  const refused = p.state === "output-available" && p.output && typeof p.output === "object" && "error" in p.output ? String((p.output as { error: unknown }).error) : undefined;
  const failed = p.state === "output-error" || p.state === "output-denied" || refused !== undefined;
  const running = !failed && p.state !== "output-available";
  return (
    <div className="flex items-start gap-2 py-0.5 text-sm text-dim">
      {running ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : failed ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 flex-1 break-words">
        {running ? `${label(name)}…` : failed ? uiTrouble(name, refused ?? (p.state === "output-error" ? p.errorText : "")) : uiWords(name, p.input, title)}
      </span>
    </div>
  );
}

/** The owner's own words: a message, or one sent into a running reply (a steering message). Photos as thumbnails, PDFs by name. */
function Said({ parts }: { parts: Part[] }) {
  // a share from another app reads as "Shared: …", not as the <shared> block the agent gets
  const text = plainShared(parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
  const files = parts.filter((p) => p.type === "file");
  return (
    <div className="flex flex-col items-end gap-1.5">
      {files.length ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {files.map((f, i) => f.mediaType.startsWith("image/")
            ? <img key={i} src={f.url} alt={f.filename ?? "Photo"} className="max-h-40 max-w-48 rounded-xl border border-line object-cover" />
            : <span key={i} className="flex max-w-56 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-xs"><FileText className="size-4 shrink-0 text-dim" /><span className="truncate">{f.filename ?? "PDF"}</span></span>)}
        </div>
      ) : null}
      {text ? <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-raised px-3.5 py-2 text-sm">{text}</p> : null}
    </div>
  );
}

type Props = {
  m: UIMessage; streaming: boolean; live: boolean; last: boolean; respond: ChatAddToolApproveResponseFunction;
  /** Answers an `ask_choice` call (a stable function, or the memo below is lost). */
  choose: (toolCallId: string, output: ChoiceOutput) => void;
};

/** Memoised: only the streaming turn re-renders on each tick, not the whole history. `last`: the newest message, the
 *  only one whose confirm card can still be answered; an older one was passed over. */
export const Turn = memo(function Turn({ m, streaming, live, last, respond, choose }: Props) {
  const { data: notes } = useNotes();
  const tasks = useTasks().data;
  const titleOf = useMemo(() => {
    const t = new Map((notes ?? []).map((n) => [n.path, n.note.title]));
    return (path: unknown) => (typeof path === "string" && t.get(path)) || String(path ?? "");
  }, [notes]);
  /** The title the app has for the record a UI tool names (undefined once it is gone, or for a view). */
  const recordTitle = (name: string, i: Record<string, unknown>) =>
    name === "open_note" ? notes?.find((n) => n.path === i.path)?.note.title
      : name === "open_task" ? tasks?.find((t) => t.id === i.id)?.title : undefined;

  const cards = useMemo(() => cardsByPart(m.parts), [m.parts]);

  if (m.role === "user") return <Rise live={live}><Said parts={m.parts} /></Rise>;
  const { parts } = m;
  const answer = parts.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n\n").trim();

  const show = ({ i, end }: Step) => {
    const p = parts[i];
    if (p.type === "reasoning") {
      // A run of reasoning parts is one thought. Folded, even while live
      const text = parts.slice(i, end + 1).map((r) => (r.type === "reasoning" ? r.text : "")).join("\n\n").trim();
      const busy = streaming && end === parts.length - 1;
      return (
        <Fold key={i} icon={<ListChecks className="size-4 shrink-0" />} title={busy ? "Thinking…" : "Thought"} busy={busy}>
          {text ? <p className="whitespace-pre-wrap text-[13px] leading-snug text-dim">{text}</p> : null}
        </Fold>
      );
    }
    if (p.type === "steering-message") return <Said key={i} parts={p.parts} />;
    if (p.type === "text") return <Markdown key={i} body={streaming && i === parts.length - 1 ? remend(p.text) : p.text} />;
    if (!isTool(p)) return null;
    const name = toolName(p), shown = cards.get(i);
    // The question: buttons while it waits for the owner, then what they chose
    if (isAskTool(name)) return <Choice key={i} p={p} last={last} live={live} answer={choose} />;
    // The app doing what it was asked (open_note …): a quiet line, no fold
    if (name === "draw") return <DrawRow key={i} p={p} />;
    if (isAppTool(name)) return <UiRow key={i} name={name} p={p} title={recordTitle(name, (p.input ?? {}) as Record<string, unknown>)} />;
    const approval = "approval" in p ? p.approval : undefined;
    // Asked and passed over for a newer message: it never ran
    const passed = !last && answered(p);
    const unconfirmed = passed || (p.state === "output-denied" && approval?.reason === UNCONFIRMED);
    const declined = p.state === "output-denied" && !unconfirmed;
    const decided = approval?.approved === undefined || unconfirmed || p.state === "output-error" ? undefined : approval.approved ? "yes" : "no";
    if ((p.state === "approval-requested" && last && !live) || decided)
      return (
        <div key={i} className="space-y-2">
          <Confirm name={name} input={(p.input ?? {}) as WriteInput} id={approval?.id ?? ""} respond={respond} answer={decided} />
          {shown ? <Cards cards={shown} live={live} /> : null}
        </div>
      );
    // A widget (day, week, review, quote, link, lens, tasks, notes) is drawn by its type; one that came back as an error, or doesn't hold together, keeps its row
    const widget = isWidgetTool(name) && p.state === "output-available" ? widgetOf(p.output) : null;
    if (widget) return <WidgetView key={i} widget={widget} />;
    // What it chose to show is the cards alone (a failed call keeps its row)
    if (name === "show_items" && p.state === "output-available") return shown ? <Cards key={i} cards={shown} live={live} /> : null;
    const detail = p.input && typeof p.input === "object" ? detailOf(name, p.input as Record<string, unknown>, titleOf) : "";
    const failed = p.state === "output-error" || p.state === "output-denied" || passed;
    const running = !failed && !settledState(p);
    const why = p.state === "output-error" ? p.errorText : unconfirmed ? "Not confirmed" : declined ? "You declined" : "";
    return (
      <div key={`${i}${failed ? "!" : ""}`} className="space-y-2">
        <Fold icon={failed ? <TriangleAlert className="size-4 shrink-0 text-warn" /> : <Check className="size-4 shrink-0" />}
          title={detail ? `${label(name)} · ${detail.slice(0, 80)}` : label(name)} busy={running} defaultOpen={failed && !unconfirmed}>
          {why ? <p className="text-[13px] text-dim">{why}</p> : null}
        </Fold>
        {shown ? <Cards cards={shown} live={live} /> : null}
      </div>
    );
  };

  /** A finished step with nothing to act on: a thought, or a read or search that came back (not a write, which has a card). */
  const quiet = ({ i, end }: Step): Kind | undefined => {
    const p = parts[i];
    if (p.type === "reasoning") return streaming && end === parts.length - 1 ? undefined : "think";
    if (!isTool(p) || p.state !== "output-available" || "approval" in p || cards.has(i)) return undefined;
    return kindOf(toolName(p));
  };

  const steps = stepsOf(parts), kinds = steps.map(quiet);
  const rows: ReactNode[] = [];
  for (let a = 0; a < steps.length; ) {
    let b = a;
    while (kinds[b]) b++;
    if (b - a >= 2) {
      rows.push(
        <Rise key={`steps${steps[a].i}`} live={live}>
          <Fold icon={<ListChecks className="size-4 shrink-0" />} title={gist(kinds.slice(a, b).filter((k): k is Kind => !!k))}>
            {steps.slice(a, b).map(show)}
          </Fold>
        </Rise>,
      );
      a = b;
    } else {
      rows.push(<Rise key={steps[a].i} live={live}>{show(steps[a])}</Rise>);
      a++;
    }
  }
  return (
    <div className="space-y-3">
      {rows}
      {answer && !live ? <CopyAnswer text={answer} /> : null}
    </div>
  );
});
