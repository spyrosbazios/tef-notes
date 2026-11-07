// A note being edited. Edits are raw text on purpose, as on the phone: the file round-trips byte for byte. Typing
// saves 800 ms after the last key; the frontmatter never reaches the editor, a save puts the new body under it as
// is (a retitle rewrites it). When the note moved on meanwhile — the phone, the CLI — the draft is merged into it
// from `start`, the body it began from; where both changed the same lines nothing is written and the owner picks.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mergeDraft, parseNote, withBody } from "@/core/notes";
import { message } from "@/services/api";
import type { NoteRec, Rec } from "@/services/notes";
import { NOTES, write } from "./notes";

export type Status = "saved" | "unsaved" | "saving" | "error";
export type Clash = { mine: string; theirs: string };

class Clashed extends Error {
  constructor(readonly theirs: string) { super("Edited elsewhere on the same lines."); }
}

const DELAY = 800;

export function useDraft(r: NoteRec) {
  const qc = useQueryClient();
  const [body, setBodyState] = useState<string | null>(null);     // null: the stored body
  const [title, setTitleState] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("saved");
  const [clash, setClash] = useState<Clash | null>(null);
  const draft = useRef<{ body: string | null; title: string | null }>({ body: null, title: null });
  const pending = useRef<{ body?: string; title?: string }>({});
  const start = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const running = useRef<Promise<void>>(Promise.resolve());
  const path = r.path;

  /** The record as the cache has it now: a realtime refetch may have moved it on since this render. */
  const fresh = useCallback((): Rec | undefined => qc.getQueryData<NoteRec[]>(NOTES)?.find((n) => n.path === path), [qc, path]);

  const send = useCallback(async () => {
    const p = pending.current, base = start.current, rec = fresh();
    if ((p.body == null && p.title == null) || !rec) return;
    pending.current = {};
    setStatus("saving");
    let merged = false;
    try {
      await write(qc, rec, (text) => {
        const n = parseNote(path, text);
        let b = p.body ?? n.body;
        if (p.body != null && base != null && n.body !== base) {
          const m = mergeDraft(base, p.body, n.body);
          if (m.clash) throw new Clashed(n.body);
          b = m.text;
          merged = true;
        }
        return withBody(text, n, b, p.title?.trim() || undefined);
      });
      // Typed on since this went: the draft goes on from what was sent. Otherwise the editor shows the stored body.
      if (p.body != null) {
        if (draft.current.body === p.body) { draft.current.body = null; setBodyState(null); start.current = null; }
        else start.current = p.body;
      }
      if (p.title != null && draft.current.title === p.title) { draft.current.title = null; setTitleState(null); }
      setStatus(pending.current.body == null && pending.current.title == null ? "saved" : "unsaved");
      if (merged) toast("Merged with an edit made on another device.");
    } catch (e) {
      if (e instanceof Clashed) {
        setClash({ mine: p.body ?? "", theirs: e.theirs });
        setStatus("unsaved");
        return;
      }
      pending.current = { ...p, ...pending.current };     // try again with the next keystroke, or on Save
      setStatus("error");
      toast.error(message(e));
    }
  }, [qc, path, fresh]);

  /** Whatever is pending, sent now; one save at a time. */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    running.current = running.current.then(send);
    return running.current;
  }, [send]);

  const later = () => {
    setStatus("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, DELAY);
  };

  const setBody = (t: string) => {
    if (start.current == null) start.current = draft.current.body ?? r.note.body;     // what the editor showed as typing began
    draft.current.body = t; setBodyState(t);
    pending.current.body = t;
    later();
  };
  const setTitle = (t: string) => {
    draft.current.title = t; setTitleState(t);
    pending.current.title = t;
    later();
  };

  /** A clash settled: mine written over theirs, as the owner chose, or theirs kept and the draft dropped. */
  const resolve = async (keep: "mine" | "theirs") => {
    const c = clash;
    setClash(null);
    if (!c) return;
    if (keep === "theirs") {
      draft.current.body = null; setBodyState(null); start.current = null; setStatus("saved");
      return;
    }
    start.current = c.theirs;                       // merging from theirs: nothing of theirs left to clash with
    pending.current.body = draft.current.body ?? c.mine;
    await flush();
  };

  // Leaving the note (or the page) sends what's pending
  useEffect(() => () => { void flush(); }, [flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current.body != null || pending.current.title != null) { void flush(); e.preventDefault(); } };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [flush]);

  return { body: body ?? r.note.body, title: title ?? r.note.title, editing: body != null, status, clash, setBody, setTitle, flush, resolve };
}
