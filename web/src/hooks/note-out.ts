// What a note's menu does with it beyond editing: hand it to the assistant, or download it. `recs` are the notes acted on
// (one, or the selection); the agent reads them itself, named in the draft by title and path (core/handoff.ts).
import { toast } from "sonner";
import { aboutNotes } from "@/core/handoff";
import { downloadNotes } from "@/lib/export";
import { message } from "@/services/api";
import type { NoteRec } from "@/services/notes";
import { useAssistant } from "./assistant";

export function useNoteOut() {
  const assistant = useAssistant();
  return {
    /** The dock opened, its field naming these notes, for the question to be typed after; the thread on screen goes on. */
    ask: (recs: NoteRec[]) => {
      if (recs.length) assistant.show(aboutNotes(recs.map((r) => ({ path: r.path, title: r.note.title }))));
    },
    /** One note as its `.md`; several as a zip with their photos. */
    download: async (recs: NoteRec[]) => {
      if (!recs.length) return;
      try { await downloadNotes(recs); } catch (e) { toast.error(message(e)); }
    },
  };
}
