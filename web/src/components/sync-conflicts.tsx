// Settings > Server & sync > Conflicts: notes edited here and on another device on the same lines, which the sync could not merge
// (packages/core/src/sync.ts), so neither was sent. As on the phone (mobile/src/ui/conflicts.tsx) the owner picks a side: keep the
// text made here, which then goes up over the server's, or use the server's, which keeps the text made here to restore until it is
// restored or dismissed. Tasks never get here: their edits merge field by field.
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { parseNote } from "@/core/notes";
import { Button } from "@/components/ui/button";
import { settleNote } from "@/hooks/notes";
import { useSyncStatus } from "@/hooks/sync";
import { local } from "@/lib/local";
import type { Settle } from "@/lib/sync";

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
