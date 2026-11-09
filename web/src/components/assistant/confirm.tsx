// A note write the agent proposes, shown as what it does before it is done: a new note rendered, the lines an append
// adds, a rewrite as a line diff, a flag change in one line, a place as its card (place-preview.tsx). The user decides. Changes carry a sign or a word as well as
// a colour (never colour alone). Answered, the card folds into one line.
import { useQuery } from "@tanstack/react-query";
import type { ChatAddToolApproveResponseFunction } from "ai";
import { Check, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { DECLINED, diffLines, flagLine, lensLine, rowsOf, tagLine, todoLines, todoWords, type Line, type WriteInput } from "@/core/agent";
import { appended, parseNote } from "@/core/notes";
import { useNotes } from "@/hooks/notes";
import { cn } from "@/lib/utils";
import { memory } from "@/services/notes";
import { usePlaceTarget } from "@/hooks/place-target";
import { PlacePreview } from "./place-preview";

const CONTEXT = 2;                          // unchanged lines kept around each change; the rest fold to a count

function DiffLine({ l }: { l: Line }) {
  return (
    <div className={cn("whitespace-pre-wrap break-words font-mono text-[13px] leading-5", l.op === "+" ? "bg-up/10 text-up" : l.op === "-" ? "bg-down/10 text-down line-through" : "text-dim")}>
      {l.op === "+" ? "+ " : l.op === "-" ? "− " : "  "}{l.text || " "}
    </div>
  );
}

/** Two texts as what changed, line by line: the changes with a little context, the unchanged runs a click away. */
function TextDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before.split("\n"), after.split("\n")), [before, after]);
  const [all, setAll] = useState(false);
  const n = (op: Line["op"]) => lines.filter((l) => l.op === op).length;
  const same = n("=");
  const summary = ([["added", n("+")], ["removed", n("-")], ["unchanged", same]] as const).filter(([, k]) => k).map(([w, k]) => `${k} ${w}`).join(" · ");
  const rows = useMemo(() => rowsOf(lines, CONTEXT, all), [lines, all]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-dim">{same === lines.length ? "No changes" : summary}</p>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-line py-1">
        {rows.map((r, i) => ("l" in r ? <DiffLine key={i} l={r.l} />
          : <p key={i} className="font-mono text-xs leading-5 text-faint">{`  ⋯ ${r.fold} unchanged line${r.fold === 1 ? "" : "s"}`}</p>))}
      </div>
      {all || rows.some((r) => "fold" in r) ? (
        <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-medium text-brand hover:underline">{all ? "Only the changes" : "Show the whole note"}</button>
      ) : null}
    </div>
  );
}

/** The note's body as the web app holds it now: what a rewrite or an append is read against. */
function useBody(path: string | undefined) {
  const { data } = useNotes();
  const text = data?.find((n) => n.path === path)?.text;
  return useMemo(() => (path && text != null ? parseNote(path, text).body : ""), [path, text]);
}

/** A rewrite: the body as it is now against the proposed one, and a retitle if there is one. */
function RewriteDiff({ path, title, input }: { path: string; title: string; input: WriteInput }) {
  const body = useBody(path);
  const retitle = input.title?.trim() && input.title.trim() !== title ? input.title.trim() : undefined;
  return (
    <div className="space-y-3">
      {retitle ? (
        <div className="space-y-0.5 text-[13px]">
          <p className="text-xs font-semibold text-dim">New title</p>
          <p className="text-down line-through">− {title}</p>
          <p className="text-up">+ {retitle}</p>
        </div>
      ) : null}
      <TextDiff before={body.trimEnd()} after={(input.text ?? "").trimEnd()} />
    </div>
  );
}

/** An append: exactly the lines it adds (a `## ` heading too, when the section is new), as the note will show them. */
function AppendPreview({ path, input }: { path: string; input: WriteInput }) {
  const body = useBody(path);
  const added = useMemo(() => {
    const after = appended(body, input.text ?? "", input.section);
    return diffLines(body.split("\n"), after.split("\n")).filter((l) => l.op === "+").map((l) => l.text).join("\n").trim();
  }, [body, input.text, input.section]);
  return <Markdown body={added} />;
}

/** A task write: what it does, a line each. */
function TodoPreview({ name, input }: { name: string; input: WriteInput }) {
  const lines = todoLines(name, input);
  return <div className="space-y-1">{lines.length ? lines.map((l, i) => <p key={i} className="whitespace-pre-wrap break-words text-sm">{l}</p>) : <p className="text-sm">No change</p>}</div>;
}

function MemoryDiff({ text }: { text: string }) {
  const { data } = useQuery({ queryKey: ["memory"], queryFn: memory });
  return <TextDiff before={(data?.text ?? "").trimEnd()} after={text.trimEnd()} />;
}

/** What an answered card says: what was done, or what was left undone. */
const VERB: Record<string, [done: string, skipped: string]> = {
  create_tag: ["Created", "create"], create_lens: ["Created", "create"], update_tag: ["Updated", "update"],
  create_note: ["Created", "create"], append_to_note: ["Added to", "add to"], rewrite_note: ["Rewrote", "rewrite"], summarise_links: ["Summarised links in", "summarise links in"],
  set_note_flags: ["Changed flags of", "change flags of"], delete_note: ["Deleted", "delete"], update_memory: ["Updated", "update"],
  set_place: ["Set the place of", "set the place of"],
};

/** The agent wants to write one of the notes (or, after reading the web, its memory): show it and why; The user decides.
 *  `answer`: once decided the card is one line (a tick or a dash). */
export function Confirm({ name, input, id, respond, answer }: {
  name: string; input: WriteInput; id: string; respond: ChatAddToolApproveResponseFunction; answer?: "yes" | "no";
}) {
  const { data } = useNotes();
  const title = (input.path ? data?.find((n) => n.path === input.path)?.note.title : undefined) ?? input.path ?? "the note";
  const todo = todoWords(name, input), target = usePlaceTarget(input);
  const head = todo?.head ?? ({
    create_tag: `Create tag “${input.name ?? ""}”?`, create_lens: `Create lens “${input.name ?? ""}”?`, update_tag: `Update tag “${input.name ?? input.id ?? ""}”?`,
    create_note: `Create note “${input.title ?? ""}”?`, append_to_note: `Add to ${title}?`, rewrite_note: `Rewrite ${title}?`, summarise_links: `Summarise the links in ${title}?`,
    set_note_flags: `Change flags of ${title}?`, delete_note: `Delete ${title}?`, update_memory: "Update the agent's memory?",
    set_place: input.clear ? `Remove the place of ${target.title}?` : `Set the place of ${target.title}?`,
  } as Record<string, string>)[name] ?? "Go ahead?";
  const yes = todo?.yes ?? (name === "create_note" ? "Create it" : name === "append_to_note" ? "Add it" : name === "delete_note" ? "Delete it" : "Save it");
  const flags = name === "create_note" ? flagLine(input) : "";
  const [done, skipped] = todo ? [todo.done, todo.skipped] : VERB[name] ?? ["Allowed", "allow"];
  const subject = todo?.subject ?? ((name === "create_tag" || name === "update_tag") ? `tag “${input.name ?? input.id ?? ""}”` : name === "create_lens" ? `lens “${input.name ?? ""}”` : name === "create_note" ? `“${input.title ?? ""}”` : name === "update_memory" ? "memory" : name === "set_place" ? target.title : title);

  if (answer)
    return (
      <div className="flex items-center gap-2 text-[13px] text-dim">
        {answer === "yes" ? <Check className="size-3.5 shrink-0 text-up" /> : <Minus className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate">{answer === "yes" ? `${done} ${subject}` : `Didn't ${skipped} ${subject}`}</span>
      </div>
    );
  return (
    <div className="space-y-3 rounded-2xl border border-brand/40 bg-card p-4">
      <p className="font-semibold">{head}</p>
      {name === "update_memory" ? <p className="text-xs text-warn">This chat read web pages, or a note written from them, so it asks first.</p> : null}
      {input.why ? <p className="text-[13px] text-dim">{input.why}</p> : null}
      {flags ? <p className="text-xs text-dim">{flags}</p> : null}
      {name === "append_to_note" && input.section ? <p className="text-xs text-dim">{`Under “${input.section}”`}</p> : null}
      <div className="border-t border-line pt-3">
        {name === "create_note" ? <Markdown body={input.body ?? ""} />
          : name === "append_to_note" && input.path ? <AppendPreview path={input.path} input={input} />
          : name === "rewrite_note" && input.path ? <RewriteDiff path={input.path} title={title} input={input} />
          : (name === "create_tag" || name === "update_tag") ? <p className="whitespace-pre-wrap text-sm">{tagLine(name, input)}</p>
          : name === "create_lens" ? <p className="whitespace-pre-wrap text-sm">{lensLine(input)}</p>
          : name === "set_note_flags" ? <p className="text-sm">{flagLine(input, true) || "No change"}</p>
          : name === "set_place" ? <PlacePreview input={input} />
          : name === "summarise_links" ? <p className="text-sm">A summary under each link card without one, as its Summary button writes it</p>
          : name === "delete_note" ? <p className="text-sm">Delete it for good, with its photos and PDFs</p>
          : todo ? <TodoPreview name={name} input={input} />
          : name === "update_memory" ? <MemoryDiff text={input.text ?? ""} />
          : <p className="text-sm">{input.text ?? ""}</p>}
      </div>
      <div className="flex gap-2">
        <Button className="flex-1 rounded-full" onClick={() => respond({ id, approved: true })}>{yes}</Button>
        <Button variant="secondary" className="flex-1 rounded-full" onClick={() => respond({ id, approved: false, reason: DECLINED })}>Not now</Button>
      </div>
    </div>
  );
}
