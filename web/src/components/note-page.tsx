// A note on its own page (`/note/<id>`): nothing but the note, with a way back. The page is the whole window: no rail, no
// list, so the editor has the room (note-pane.tsx is the editor and its tools). It lies over the screen it was opened from (App.tsx
// `NoteLayer`), which stays mounted under it.
import { ChevronLeft } from "lucide-react";
import { useEffect } from "react";
import { Boundary } from "@/components/boundary";
import { NotePane } from "@/components/note-pane";
import { Button } from "@/components/ui/button";
import { useNoteAt, useNotes } from "@/hooks/notes";
import { useNav } from "@/lib/nav";

export function NotePage({ id }: { id: string }) {
  const { openNote, leaveNote, followNote } = useNav();
  const { isPending } = useNotes();
  const n = useNoteAt(id), at = n?.note.id;
  // A note made here that moved aside on its first push (another device had the name) is the same note: the address follows it
  useEffect(() => { if (at && at !== id) void followNote(at); }, [at, id, followNote]);
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
  // A throw in the note is the note's alone: the screen under it and the dock beside it stay
  return <Boundary what="The note" resetKey={id}><NotePane key={n.rec} n={n} leading={back} onNote={openNote} onGone={leaveNote} /></Boundary>;
}
