// One turn of the assistant's chat (src/ui/assistant.tsx): a user's bubble, or the agent's reply — a tool call is a ToolRow,
// the answer streaming markdown, a write a confirm card, and the notes and tasks a call wrote or the agent chose
// to show (show_items) cards under it (./cards.tsx); a show_* call is its widget (./widgets.tsx), and ask_choice its buttons
// (./choice.tsx).
import { getToolName, isToolUIPart, type ChatAddToolApproveResponseFunction, type UIMessage } from "ai";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { KeyboardEvents } from "react-native-keyboard-controller";
import remend from "remend";
import { cardsByPart, flagLine, gist, kindOf, label, UNCONFIRMED, type Kind, type ToolName, type WriteInput } from "@/core/agent";
import { choiceFrom, chosenOf, isAskTool } from "@/core/assistant";
import { citedIn, sourcesOf } from "@/core/citations";
import { plainShared } from "@/core/share";
import { isWidgetTool, widgetOf } from "@/core/widgets";
import { useNotes } from "@/store/notes";
import { Confirm } from "../confirm";
import { IconButton } from "../ds";
import { openLink, useMarkdownStyle } from "../note";
import { Steps } from "../steps";
import { useTheme } from "../use-theme";
import { Appear, MessageBubble } from "./bubble";
import { Cards } from "./cards";
import { Choice } from "./choice";
import { Reasoning } from "./reasoning";
import { Sources } from "./sources";
import { useChatScroller } from "./scroller";
import { ToolLine, ToolRow } from "./tool-row";
import { WidgetView } from "./widgets";

type Part = UIMessage["parts"][number];

const STATUS = { "input-streaming": "pending", "input-available": "running", "approval-requested": "pending", "approval-responded": "running",
  "output-available": "complete", "output-error": "error", "output-denied": "error" } as const;

const titleOf = (path: unknown) => (typeof path === "string" && useNotes.getState().notes[path]?.title) || String(path ?? "");
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** The line under a tool's name: what it looked for, which note, or the agent's why. */
const DETAIL: Record<ToolName, (i: Record<string, unknown>) => string> = {
  search_notes: (i) => str(i.query), list_notes: (i) => [str(i.filter), str(i.tag)].filter(Boolean).join(" · "),
  list_tags: () => "", show_items: () => "",
  read_note: (i) => titleOf(i.path), create_note: (i) => str(i.title), append_to_note: (i) => titleOf(i.path),
  rewrite_note: (i) => str(i.why) || titleOf(i.path), set_note_flags: (i) => `${titleOf(i.path)} · ${flagLine(i as WriteInput, true)}`, delete_note: (i) => titleOf(i.path),
  list_tasks: (i) => [str(i.view), str(i.query), str(i.tag)].filter(Boolean).join(" · "), add_task: (i) => str(i.title), add_tasks: () => "", update_task: (i) => str(i.about), complete_task: (i) => str(i.about),
  delete_task: (i) => str(i.about),
  update_memory: (i) => str(i.why), web_search: (i) => str(i.query), read_url: (i) => (Array.isArray(i.urls) ? i.urls.join(", ") : ""),
  open_note: (i) => titleOf(i.path), open_task: (i) => str(i.id), go_view: (i) => [str(i.view), str(i.tag)].filter(Boolean).join(" · "),
  ask_choice: (i) => str(i.question),
  show_day: (i) => str(i.date), show_week: (i) => str(i.start), show_review: (i) => (typeof i.days === "number" ? `${i.days} days` : ""),
  show_quote: (i) => titleOf(i.path), show_link: (i) => str(i.url), show_lens: (i) => str(i.name), find_free_slots: (i) => str(i.date),
};

export const shown = (p: Part) => p.type === "reasoning" || isToolUIPart(p) || (p.type === "text" && !!p.text);
export const settled = (p: Part) => isToolUIPart(p) && (p.state === "output-available" || p.state === "output-error" || p.state === "output-denied");

function CopyAnswer({ text }: { text: string }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = () => { void Clipboard.setStringAsync(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <IconButton label="Copy answer" compact size={16} icon={copied ? Check : Copy} color={copied ? C.brand : C.dim} className="self-start -ms-2.5 -mt-2" onPress={copy} />
  );
}

/** Answer text as it arrives: remend closes half-written markdown (`**bo` reads as bold, not asterisks),
 *  and the native view fades each new tail in instead of popping it. A link to a note opens it in the app.
 *  A box in an answer is the agent's text, not a note's: it doesn't tick. */
function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  const md = useMarkdownStyle();
  return (
    <EnrichedMarkdownText flavor="github" markdown={streaming ? remend(text) : text} markdownStyle={md} selectable
      streamingAnimation={streaming} md4cFlags={{ latexMath: false }}     // `$50` is money, not math
      enableTaskListItemToggle={false} onLinkPress={({ url }) => openLink(url)} />
  );
}

const toolName = (p: Part) => (isToolUIPart(p) ? getToolName(p) : undefined);
/** The parts of a message worth a row: a run of reasoning parts is one thought, kept at its first index (`i`..`end`). */
type Step = { i: number; end: number };
function stepsOf(parts: Part[]) {
  const steps: Step[] = [];
  parts.forEach((p, i) => {
    if (p.type === "reasoning" && parts[i - 1]?.type === "reasoning") steps[steps.length - 1].end = i;
    else if (p.type === "reasoning" || p.type === "text" || isToolUIPart(p)) steps.push({ i, end: i });
  });
  return steps;
}

/** Memoised: only the streaming turn re-renders on each tick, not the whole history. `last`: the newest message —
 *  only its confirm card or question (`choose`), once the reply has stopped, can still be answered; an older one was passed over.
 *  Consecutive finished thoughts and tool calls fold into one summary row (`Steps`); what is still moving, failed,
 *  or left a note to open stays a row of its own. */
export const Turn = memo(function Turn({ m, streaming, live, last, respond, choose }: { m: UIMessage; streaming: boolean; live: boolean; last: boolean; respond: ChatAddToolApproveResponseFunction; choose: (toolCallId: string, chosen: string[]) => void }) {
  const cards = useMemo(() => cardsByPart(m.parts), [m.parts]);
  // The sources this turn read and the ones its answer cites (packages/core/src/citations.ts): the phone lists them
  const sources = useMemo(() => sourcesOf(m.parts), [m.parts]);
  const answer = useMemo(() => m.parts.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n\n").trim(), [m.parts]);
  const cited = useMemo(() => citedIn(answer, sources), [answer, sources]);
  if (m.role === "user")
    return (
      // a share from another app reads as "Shared: …", not as the <shared> block the agent gets
      <MessageBubble align="end" animate={live} text={plainShared(m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""))} />
    );
  const { parts } = m;

  const show = ({ i, end }: Step) => {
    const p = parts[i];
    if (p.type === "reasoning") {
      // A run of reasoning parts is one thought. Folded, even while live
      const text = parts.slice(i, end + 1).map((r) => (r.type === "reasoning" ? r.text : "")).join("\n\n").trim();
      return (
        <Reasoning key={i} text={text} streaming={streaming && end === parts.length - 1} />
      );
    }
    if (p.type === "text") return <Answer key={i} text={p.text} streaming={streaming && i === parts.length - 1} />;
    if (!isToolUIPart(p)) return null;
    const name = toolName(p) ?? "";
    const here = cards.get(i);
    // Asked and passed over for a new message (or tapped with nothing resent): the server denies it on the next send
    const passed = !last && (p.state === "approval-requested" || p.state === "approval-responded");
    const unconfirmed = passed || (p.state === "output-denied" && p.approval.reason === UNCONFIRMED);
    const approved = "approval" in p ? p.approval?.approved : undefined;
    // One element from the question to the settled line, so the card folds into its row
    const decided = approved === undefined || unconfirmed || p.state === "output-error" ? undefined : approved ? "yes" : "no";
    if ((p.state === "approval-requested" && last && !live) || decided)
      return (
        <View key={i} className="gap-2">
          <Confirm name={name} input={(p.input ?? {}) as WriteInput} id={"approval" in p && p.approval ? p.approval.id : ""} respond={respond} answer={decided} />
          {here ? <Cards cards={here} /> : null}
        </View>
      );
    // A question is its buttons while it waits, and the line of what was chosen after; an error answer keeps its row
    if (isAskTool(name) && (p.state === "input-available" || p.state === "output-available")) {
      const ask = choiceFrom(p.input), chosen = p.state === "output-available" ? chosenOf(p.output) : null;
      if (ask && (p.state === "input-available" || chosen))
        return <Choice key={i} ask={ask} chosen={chosen} open={last && !live} answer={(ids) => choose(p.toolCallId, ids)} />;
    }
    // A widget is drawn in place of its row; one that can't be read keeps the row
    if (isWidgetTool(name) && p.state === "output-available") {
      const widget = widgetOf(p.output);
      if (widget) return <WidgetView key={i} widget={widget} />;
    }
    // What it chose to show is the cards alone (a failed call keeps its row)
    if (name === "show_items" && p.state === "output-available") return here ? <Cards key={i} cards={here} /> : null;
    const input = p.input && typeof p.input === "object" ? (DETAIL[name as ToolName]?.(p.input as Record<string, unknown>) ?? "") : "";
    const failed = p.state === "output-error" || p.state === "output-denied" || passed;
    return (
      <View key={`${i}${failed ? "!" : ""}`} className="gap-2">
        {/* Folded unless it failed; the key remounts it on failure so it opens then */}
        <ToolRow title={label(name)} defaultOpen={failed && !unconfirmed} status={passed ? "error" : STATUS[p.state as keyof typeof STATUS] ?? "running"}>
          {input ? <ToolLine>{input.slice(0, 80)}</ToolLine> : null}
          {p.state === "output-error" ? <ToolLine>{p.errorText}</ToolLine> : null}
          {unconfirmed ? <ToolLine>Not confirmed</ToolLine> : p.state === "output-denied" ? <ToolLine>You declined</ToolLine> : null}
        </ToolRow>
        {here ? <Cards cards={here} /> : null}
      </View>
    );
  };

  /** A finished step with nothing to act on: a thought, or a read or search that came back (not a write, which has a card). */
  const quiet = ({ i, end }: Step): Kind | undefined => {
    const p = parts[i];
    if (p.type === "reasoning") return streaming && end === parts.length - 1 ? undefined : "think";
    if (!isToolUIPart(p) || p.state !== "output-available" || "approval" in p || cards.has(i)) return undefined;
    return kindOf(toolName(p) ?? "");
  };

  const steps = stepsOf(parts), kinds = steps.map(quiet);
  const rows: ReactNode[] = [];
  for (let a = 0; a < steps.length; ) {
    let b = a;
    while (kinds[b]) b++;
    if (b - a >= 2) {
      rows.push(<Appear key={`steps${steps[a].i}`} live={live}><Steps summary={gist(kinds.slice(a, b).filter((k): k is Kind => !!k))}>{steps.slice(a, b).map(show)}</Steps></Appear>);
      a = b;
    } else {
      rows.push(<Appear key={steps[a].i} live={live}>{show(steps[a])}</Appear>);
      a++;
    }
  }
  return (
    <View className="gap-3">
      {rows}
      {cited.length ? <Sources cited={cited} /> : null}
      {answer && !live ? <CopyAnswer text={answer} /> : null}
    </View>
  );
});

/** The keyboard shrinks the list from the bottom: bring the newest lines back into view, not the oldest. */
export function KeepEnd() {
  const { scrollToEnd } = useChatScroller();
  useEffect(() => {
    const sub = KeyboardEvents.addListener("keyboardDidShow", () => scrollToEnd(true));
    return () => sub.remove();
  }, [scrollToEnd]);
  return null;
}
