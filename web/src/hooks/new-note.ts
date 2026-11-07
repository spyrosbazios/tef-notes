// "New note": the note is made at once, as Untitled, and opened on its own page with the title selected to be typed over.
// The title names the file (notes/YYYYMMDD-untitled.md), which never changes after, as a retitle doesn't rename it.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { noteIdOf, UNTITLED } from "@/core/notes";
import { useNav } from "@/lib/nav";
import { message } from "@/services/api";
import { createNote } from "./notes";

/** Makes a note and opens it; a second call while one is being made is ignored. The function is the same across renders. */
export function useNewNote(): () => void {
  const qc = useQueryClient(), nav = useNav();
  const busy = useRef(false), open = useRef(nav.openNote);
  useEffect(() => { open.current = nav.openNote; });
  return useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    createNote(qc, UNTITLED)
      .then((r) => open.current(noteIdOf(r.path)))
      .catch((e) => toast.error(message(e)))
      .finally(() => { busy.current = false; });
  }, [qc]);
}
