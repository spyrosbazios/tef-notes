// A note write the agent proposes, shown as what it does before it is done: a new note rendered, the lines an append
// adds, a rewrite as a line diff, a flag change in one line, a place as its card (place-preview.tsx). The user decides. Changes carry a sign or a word as well as
// a colour (never colour alone). Answered, the card folds into one line.
import { useQuery } from "@tanstack/react-query";
import type { ChatAddToolApproveResponseFunction } from "ai";
import { Check, Ellipsis, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { DECLINED, diffLines, rowsOf, type Line, type WriteInput } from "@/core/agent";
import { previewWrite, type NoteRead } from "@/core/note-read";
import { appended, MEMORY, parseNote, withBody } from "@/core/notes";
import { CONFIRM, type Preview, type WriteTool } from "@/core/tool-words";
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
          : (
            <p key={i} className="flex items-center gap-1.5 pl-[2ch] font-mono text-xs leading-5 text-faint">
              <Ellipsis className="size-3.5 shrink-0" aria-hidden />{`${r.fold} unchanged line${r.fold === 1 ? "" : "s"}`}
            </p>
          )))}
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

/** What the server will make of a whole-file write over a file edited since the agent read it (core/note-read.ts previewWrite),
 *  in words under the diff: the edits kept, or why it will be refused. Nothing while the file is as it was read. */
function WriteNote({ view }: { view: ReturnType<typeof previewWrite> | null }) {
  if (!view) return null;
  if ("text" in view) return view.merged ? <p className="text-xs text-dim">Your edits since the agent read this are kept.</p> : null;
  return (
    <p className="text-xs text-warn">
      {view.problem === "overlap" ? "This was edited since the agent read it, in the same lines" : "This was edited since the agent read it"}: confirming writes nothing, and the agent reads it again.
    </p>
  );
}

/** A rewrite: the body as it is now against the one it will leave (the proposed one, with edits made since the agent read the note
 *  folded in), and a retitle if there is one. */
function RewriteDiff({ path, title, input, reads }: { path: string; title: string; input: WriteInput; reads: readonly NoteRead[] }) {
  const { data } = useNotes();
  const body = useBody(path), live = data?.find((n) => n.path === path);
  const view = useMemo(() => (live && input.rev != null
    ? previewWrite(path, input.rev, reads, live, (file) => withBody(file, parseNote(path, file), `${(input.text ?? "").trimEnd()}\n`, input.title?.trim()))
    : null), [live, path, input.rev, input.text, input.title, reads]);
  const after = view && "text" in view ? parseNote(path, view.text).body : (input.text ?? "");
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
      <TextDiff before={body.trimEnd()} after={after.trimEnd()} />
      <WriteNote view={view} />
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

/** The memory file as it is now against the one it will leave (core/note-read.ts previewWrite, as a rewrite's). */
function MemoryDiff({ text, rev, reads }: { text: string; rev?: number; reads: readonly NoteRead[] }) {
  const { data } = useQuery({ queryKey: ["memory"], queryFn: memory });
  const view = useMemo(() => (data !== undefined && rev != null ? previewWrite(MEMORY, rev, reads, data, () => `${text.trimEnd()}\n`) : null), [data, rev, reads, text]);
  const after = view && "text" in view ? view.text : text;
  return (
    <div className="space-y-3">
      <TextDiff before={(data?.text ?? "").trimEnd()} after={after.trimEnd()} />
      <WriteNote view={view} />
    </div>
  );
}

/** A card's body: what core says it shows (@/core/tool-words `Preview`), drawn against the records as the app holds them now. */
function Body({ preview, path, title, input, reads }: { preview: Preview; path: string | undefined; title: string; input: WriteInput; reads: readonly NoteRead[] }) {
  switch (preview.kind) {
    case "text": return <p className="whitespace-pre-wrap break-words text-sm">{preview.text}</p>;
    case "markdown": return <Markdown body={preview.body} />;
    case "append": return path ? <AppendPreview path={path} input={input} /> : null;
    case "rewrite": return path ? <RewriteDiff path={path} title={title} input={input} reads={reads} /> : null;
    case "memory": return <MemoryDiff text={input.text ?? ""} rev={input.rev} reads={reads} />;
    case "place": return <PlacePreview input={input} />;
  }
}

/** The agent wants to make a write: show it and why; the user decides. `answer`: once decided the card is one line (a tick or
 *  a dash). Its words are core's, one entry per write tool (@/core/tool-words `CONFIRM`). */
export function Confirm({ name, input, reads, id, respond, answer }: {
  name: WriteTool; input: WriteInput; reads: readonly NoteRead[]; id: string; respond: ChatAddToolApproveResponseFunction; answer?: "yes" | "no";
}) {
  const { data } = useNotes();
  const title = (input.path ? data?.find((n) => n.path === input.path)?.note.title : undefined) ?? input.path ?? "the note";
  const target = usePlaceTarget(input);
  const card = CONFIRM[name](input, { note: title, task: target.title });

  if (answer)
    return (
      <div className="flex items-center gap-2 text-[13px] text-dim">
        {answer === "yes" ? <Check className="size-3.5 shrink-0 text-up" /> : <Minus className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate">{answer === "yes" ? `${card.done} ${card.subject}` : `Didn't ${card.skipped} ${card.subject}`}</span>
      </div>
    );
  return (
    <div className="space-y-3 rounded-2xl border border-brand/40 bg-card p-4">
      <p className="font-semibold">{card.head}</p>
      {card.warning ? <p className="text-xs text-warn">{card.warning}</p> : null}
      {input.why ? <p className="text-[13px] text-dim">{input.why}</p> : null}
      {card.notes?.map((n) => <p key={n} className="text-xs text-dim">{n}</p>)}
      <div className="border-t border-line pt-3">
        <Body preview={card.preview} path={input.path} title={title} input={input} reads={reads} />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1 rounded-full" onClick={() => respond({ id, approved: true })}>{card.yes}</Button>
        <Button variant="secondary" className="flex-1 rounded-full" onClick={() => respond({ id, approved: false, reason: DECLINED })}>Not now</Button>
      </div>
    </div>
  );
}
