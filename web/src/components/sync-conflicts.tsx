// Settings → Maintenance → Conflicts: notes edited here and on another device on the same lines, which the sync could not merge
// (packages/core/src/sync.ts), so neither was sent. The owner picks a side: keep the
// text made here, which then goes up over the server's, or use the server's, which keeps the text made here to restore until it is
// restored or dismissed. Tasks never get here: their edits merge field by field.
// And Refused: changes the server answered no to (a note, task or link it won't take as sent). They are not tried again by
// themselves; the owner sends one again as it is, or lets it go (back to the server's version). Editing it sends it again too.
import { CircleX, GitMerge } from "lucide-react";
import type { ReactNode } from "react";
import { parseNote } from "@/core/notes";
import type { Refusal } from "@/core/sync";
import { Row, Status } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { settleNote, useNoteRow } from "@/hooks/notes";
import { resolveRefused, useSyncStatus } from "@/hooks/sync";
import type { Settle } from "@/hooks/notes";

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

function ConflictRow({ path }: { path: string }) {
  const n = useNoteRow(path);
  if (!n) return null;
  const clash = n.conflict_rev != null && n.conflict_text != null;
  const pick: [Settle, string][] = clash ? [["mine", "Keep mine"], ["theirs", "Use the server's"]] : [["restore", "Restore mine"], ["dismiss", "Dismiss"]];
  return (
    <div className="space-y-2 px-3 py-2.5" data-conflict={path}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{parseNote(path, n.text).title}</p>
        <p className="text-xs leading-snug text-dim">
          {clash ? "This note changed on the server while you had unsent edits here, on the same lines. Nothing was sent." : "The server's version replaced your unsent edits here."}
        </p>
      </div>
      {clash ? <Version label="Made here" text={n.text} path={path} /> : null}
      {clash ? <Version label="On the server" text={n.conflict_text!} path={path} /> : <Version label="Your replaced edits" text={n.lost ?? ""} path={path} />}
      <div className="flex gap-2">
        {pick.map(([how, label], i) => (
          <Button key={how} size="sm" variant={i ? "outline" : "default"} className="flex-1 rounded-full" onClick={() => settleNote(path, how)}>{label}</Button>
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
      <Row icon={GitMerge} tone={conflicts.length ? "warn" : "dim"} title="Conflicts"
        detail={conflicts.length ? "Edited here and on another device, on the same lines." : undefined}>
        <Status tone={conflicts.length ? "warn" : "up"}>{conflicts.length || "None"}</Status>
      </Row>
      {conflicts.map((p) => <ConflictRow key={p} path={p} />)}
    </>
  );
}

const what = (r: Refusal) => r.kind === "link" ? (r.deleted ? "Removing a link" : "A new link")
  : `${r.deleted ? "Deleting" : "Saving"} ${r.kind === "note" ? "the note" : "the task"} “${r.title || "Untitled"}”`;

function RefusedRow({ r }: { r: Refusal }) {
  const act = (how: "retry" | "discard") => { resolveRefused(r, how); };
  return (
    <div className="space-y-2 px-3 py-2.5" data-refused={`${r.kind}:${r.key}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{what(r)}</p>
        <p className="text-xs leading-snug text-dim">The server refused it: {r.reason}</p>
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
      <Row icon={CircleX} tone="down" title="Refused" detail="The server won't take these as sent; not tried again until you say so.">
        <Status tone="down">{refused.length}</Status>
      </Row>
      {refused.map((r) => <RefusedRow key={`${r.kind}:${r.key}`} r={r} />)}
    </>
  );
}
