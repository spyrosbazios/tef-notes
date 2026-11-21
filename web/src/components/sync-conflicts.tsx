// Settings > Server & sync > Conflicts: notes edited here and on another device on the same lines, which the sync could not merge
// (packages/core/src/sync.ts), so neither was sent. The owner picks a side: keep the
// text made here, which then goes up over the server's, or use the server's, which keeps the text made here to restore until it is
// restored or dismissed. Tasks never get here: their edits merge field by field.
// And Refused: changes the server answered no to (a note, task or link it won't take as sent). They are not tried again by
// themselves; the owner sends one again as it is, or lets it go (back to the server's version). Editing it sends it again too.
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { parseNote } from "@/core/notes";
import { Button } from "@/components/ui/button";
import { settleNote } from "@/hooks/notes";
import { useSyncStatus } from "@/hooks/sync";
import { local } from "@/lib/local";
import { projectLocal } from "@/lib/local-records";
import { resolveRefused, type Settle } from "@/lib/sync";
import type { Refusal } from "@/core/sync";

/** The most of a version shown: a note may be long, and this is only to tell the two apart. */
const SHOWN = 1200;

function Version({ label, text, path }: { label: string; text: string; path: string }) {
  const body = parseNote(path, text).body.trim();
  return (
    <details className="rounded-lg border border-line px-2 py-1 text-[13px]">
      <summary className="cursor-pointer text-dim">{label}</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-snug">{body.length > SHOWN ? `${body.slice(0, SHOWN)}…` : body || "(empty)"}</pre>
    </details>
  );
}

function Row({ path }: { path: string }) {
  const qc = useQueryClient(), n = local.notes.get(path);
  if (!n) return null;
  const clash = n.conflict_rev != null && n.conflict_text != null;
  const pick: [Settle, string][] = clash ? [["mine", "Keep mine"], ["theirs", "Use the server's"]] : [["restore", "Restore mine"], ["dismiss", "Dismiss"]];
  return (
    <div className="space-y-2 px-3 py-2.5" data-conflict={path}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{parseNote(path, n.text).title}</p>
        <p className="text-[13px] leading-snug text-dim">
          {clash ? "This note changed on the server while you had unsent edits here, on the same lines. Nothing was sent." : "The server's version replaced your unsent edits here."}
        </p>
      </div>
      {clash ? <Version label="Made here" text={n.text} path={path} /> : null}
      {clash ? <Version label="On the server" text={n.conflict_text!} path={path} /> : <Version label="Your replaced edits" text={n.lost ?? ""} path={path} />}
      <div className="flex gap-2">
        {pick.map(([how, label], i) => (
          <Button key={how} size="sm" variant={i ? "outline" : "default"} className="flex-1 rounded-full" onClick={() => settleNote(qc, path, how)}>{label}</Button>
        ))}
      </div>
    </div>
  );
}

/** The rows of the Server & sync box that list the notes waiting on a side to be picked: one that says how many, and one each. */
export function Conflicts(): ReactNode {
  const { conflicts } = useSyncStatus();
  return (
    <>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Conflicts</p>
        <p className="text-[13px] leading-snug text-dim">
          {conflicts.length ? `${conflicts.length} ${conflicts.length === 1 ? "note" : "notes"} edited here and on another device at once.` : "None. A note edited on two devices at once is merged, unless both changed the same lines."}
        </p>
      </div>
      {conflicts.map((p) => <Row key={p} path={p} />)}
    </>
  );
}

const what = (r: Refusal) => r.kind === "link" ? (r.deleted ? "Removing a link" : "A new link")
  : `${r.deleted ? "Deleting" : "Saving"} ${r.kind === "note" ? "the note" : "the task"} “${r.title || "Untitled"}”`;

function RefusedRow({ r }: { r: Refusal }) {
  const qc = useQueryClient();
  const act = (how: "retry" | "discard") => {
    if (resolveRefused(r, how)) projectLocal(qc, r.kind === "note" ? "notes" : r.kind === "task" ? "tasks" : "links");
  };
  return (
    <div className="space-y-2 px-3 py-2.5" data-refused={`${r.kind}:${r.key}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{what(r)}</p>
        <p className="text-[13px] leading-snug text-dim">The server refused it: {r.reason}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 rounded-full" onClick={() => act("retry")}>Try again</Button>
        <Button size="sm" variant="outline" className="flex-1 rounded-full" onClick={() => act("discard")}>{r.deleted ? "Keep it" : "Discard the change"}</Button>
      </div>
    </div>
  );
}

/** The rows of the Server & sync box for the changes the server refused, when there are any: one that says how many, one each. */
export function Refused(): ReactNode {
  const { refused } = useSyncStatus();
  if (!refused.length) return null;
  return (
    <>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Refused</p>
        <p className="text-[13px] leading-snug text-dim">
          {`${refused.length} ${refused.length === 1 ? "change" : "changes"} the server won't take as sent. Not tried again until you say so or edit it.`}
        </p>
      </div>
      {refused.map((r) => <RefusedRow key={`${r.kind}:${r.key}`} r={r} />)}
    </>
  );
}
