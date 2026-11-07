// A note on its own page (`/note/<id>`): nothing but the note, with a way back. The page is the whole window: no rail, no
// list, so the editor has the room (note-pane.tsx is the editor and its tools).
import { ChevronLeft } from "lucide-react";
import { NotePane } from "@/components/note-pane";
import { Button } from "@/components/ui/button";
import { useNote, useNotes } from "@/hooks/notes";
import { useNav } from "@/lib/nav";

export function NotePage({ id }: { id: string }) {
  const { openNote, leaveNote } = useNav();
  const { isPending } = useNotes();
  const n = useNote(id);
  const back = <Button variant="ghost" size="sm" aria-label="Back" onClick={leaveNote}><ChevronLeft /> Back</Button>;
  if (!n) {
    if (isPending) return null;
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="space-y-4">
          <p className="text-sm text-faint">This note is gone: deleted on another device.</p>
          {back}
        </div>
      </div>
    );
  }
  return <NotePane key={n.path} n={n} leading={back} onNote={openNote} onGone={leaveNote} />;
}
