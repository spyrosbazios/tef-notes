// Save-as-you-type in React, over the one draft primitive (lib/drafts.ts). A note being edited: its body and title are drafts
// the records module owns (lib/records.ts), found by the note's record id, so they outlive the editor and follow the note if it
// moves; edits are raw text on purpose, as on the phone, so the file round-trips byte for byte, and the frontmatter never
// reaches the editor. A task's text field: a draft of its box's own (`useDraftText`). Either way a save that fails keeps what
// was typed and says why.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { boxDraft, shown, type Draft, type DraftState, type Status } from "@/lib/drafts";
import { holdDrafts, noteDrafts, pushNow } from "@/lib/records";
import type { NoteRec } from "@/services/notes";

export type { Status } from "@/lib/drafts";

const useDraftState = (d: Draft): DraftState => useSyncExternalStore(d.watch, d.get);

/** A failed save and a merged one, said as they happen. */
function useSaid(s: DraftState) {
  const merged = useRef(s.merged);
  useEffect(() => {
    if (s.merged > merged.current) toast("Merged with an edit made on another device.");
    merged.current = s.merged;
  }, [s.merged]);
  useEffect(() => { if (s.status === "error" && s.error) toast.error(s.error); }, [s.status, s.error]);
}

/** The open note's drafts. Leaving the note sends what is pending, and a sync takes it up. */
export function useDraft(r: NoteRec) {
  const { rec, path } = r;
  const d = useMemo(() => noteDrafts({ rec, path }), [rec, path]);   // the record id's drafts, the same object as the note moves
  useEffect(() => { const release = holdDrafts(rec, d); return () => { void release().then(pushNow); }; }, [rec, d]);
  const body = useDraftState(d.body), title = useDraftState(d.title);
  useSaid(body);
  useSaid(title);
  const status: Status = body.status === "error" || title.status === "error" ? "error"
    : body.status === "saving" || title.status === "saving" ? "saving"
    : body.status === "unsaved" || title.status === "unsaved" ? "unsaved" : "saved";
  return {
    body: shown(body, r.note.body), title: shown(title, r.note.title), editing: body.text != null, status, clash: body.clash,
    setBody: d.body.type, setTitle: d.title.type,
    /** Whatever is pending, sent now. */
    flush: () => Promise.all([d.body.flush(), d.title.flush()]).then(() => undefined),
    resolve: d.body.resolve,
    /** A model's words were put in the body (a link's summary): its next save carries the `tainted` mark. */
    taint: d.body.taint,
  };
}

/** A text field that saves as you type (`save`, a task's field written to the copy). The box's own draft; what is kept is `value`. */
export function useDraftText(value: string, save: (text: string) => Promise<unknown>, delay = 700) {
  const [box] = useState(() => boxDraft(value, save, delay)), d = box.draft;
  useEffect(() => { box.update(value, save); });
  useEffect(() => () => { void d.flush(); }, [d]);
  const s = useDraftState(d);
  useSaid(s);
  return { text: shown(s, value), edit: d.type, flush: () => { void d.flush(); } };
}
