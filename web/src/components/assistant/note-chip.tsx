import { FileText, X } from "lucide-react";
import type { NoteRef } from "@/core/handoff";

/** A note a message is about, as a chip: in the field with its remove button, in the chat as sent. */
export function NoteChip({ note, remove }: { note: NoteRef; remove?: () => void }) {
  return (
    <span className="flex max-w-56 items-center gap-1.5 rounded-full border border-line bg-raised py-1 pr-1 pl-2.5 text-xs" title={note.path}>
      <FileText className="size-3.5 shrink-0 text-dim" /><span className="truncate">{note.title.trim() || "Untitled"}</span>
      {remove ? <button type="button" aria-label={`Remove ${note.title || "note"}`} onClick={remove} className="grid size-4 shrink-0 place-items-center rounded-full text-dim hover:text-fg"><X className="size-3" /></button> : <span className="w-1" />}
    </span>
  );
}
