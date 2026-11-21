// Save-as-you-type: one text being edited, without a write per key. The typed text is the draft's until it is saved: it goes
// out a moment after the last key (`delay`), on `flush` (blur, Enter, Save, leaving), and a save that fails keeps it, to go
// with the next key or flush, and says why. Nothing typed is ever dropped but by the owner's word (a clash settled for theirs).
// One primitive for every such field, told two things: where the text is kept (`DraftField`: what it holds now, and the write)
// and how a draft meets a text that moved on while it was typed (`Merge`):
//   - a note's body (LINES): merged line by line from the text the typing began from (core mergeDraft); where both changed the
//     same lines nothing is written, and the owner picks (`clash`, `resolve`);
//   - a note's title, a task's title, notes or checklist item (MINE): the typed text wins; a task's other fields are merged by
//     the sync, field by field.
// Who owns a draft: an open note's are the records module's (lib/records.ts), so they outlive the editor and go into the copy
// before every sync; a task's fields are their box's (hooks/draft.ts `useDraftText`).
import { mergeDraft } from "@/core/notes";
import type { Mark } from "@/core/record-contracts";

export type Status = "saved" | "unsaved" | "saving" | "error";
export type Clash = { mine: string; theirs: string };

/** `mine` written over `theirs`, both edits of `start`: the text to write, or null when they clash. */
export type Merge = (start: string, mine: string, theirs: string) => string | null;
export const MINE: Merge = (_start, mine) => mine;
export const LINES: Merge = (start, mine, theirs) => { const m = mergeDraft(start, mine, theirs); return m.clash ? null : m.text; };

/** Where the text is kept. `read`: what it holds now, undefined when the record is gone. `write`: the text saved, with `mark`
 *  when it holds someone else's words; throws to fail (the draft keeps the text). */
export type DraftField = { read: () => string | undefined; write: (text: string, mark: Mark) => unknown };

/** `text`: what was typed and is not (or not exactly) what is kept, null when the box shows what is kept; `error`: why the
 *  last save failed; `merged`: how many saves were merged with another edit (a client says so when it moves). */
export type DraftState = { text: string | null; status: Status; clash: Clash | null; error: string | null; merged: number };

type Later = (work: () => void, ms: number) => () => void;
const later: Later = (work, ms) => { const timer = setTimeout(work, ms); return () => clearTimeout(timer); };

/** What the box shows: the typed text while it isn't saved, or while what was kept differs from it only at the edges (a store
 *  that trims would otherwise eat the space typed before a pause); else what is kept. */
export const shown = (s: DraftState, kept: string): string =>
  s.text != null && (s.status !== "saved" || s.text.trim() === kept.trim()) ? s.text : kept;

export type Draft = ReturnType<typeof createDraft>;

/** A box's own draft (MINE) over a kept value its owner hands it as it changes (`update`), saved through `save`. */
export function boxDraft(value: string, save: (text: string) => Promise<unknown>, delay: number) {
  let kept = value, saver = save;
  const draft = createDraft({ field: { read: () => kept, write: (t) => saver(t) }, merge: MINE, delay });
  return { draft, update(v: string, s: typeof save): void { kept = v; saver = s; } };
}

export function createDraft({ field, merge, delay, schedule = later }: { field: DraftField; merge: Merge; delay: number; schedule?: Later }) {
  let state: DraftState = { text: null, status: "saved", clash: null, error: null, merged: 0 };
  /** `pending`: typed and not saved. `start`: the kept text the typing began from (what both sides are diffed against).
   *  `marked`: the pending text holds someone else's words; `arm`: so does the next text typed in. */
  let pending = false, start: string | null = null, marked = false, arm = false;
  let cancel: (() => void) | undefined, chain: Promise<void> = Promise.resolve();
  const watchers = new Set<() => void>();
  const set = (p: Partial<DraftState>) => { state = { ...state, ...p }; watchers.forEach((l) => l()); };

  async function send(): Promise<void> {
    if (!pending || state.clash || state.text == null) return;
    const p = state.text, base = start, mark: Mark = marked ? { tainted: true } : {}, kept = field.read();
    pending = false;
    set({ status: "saving" });
    let out = p;
    if (kept !== undefined && base != null && kept !== base) {
      const m = merge(base, p, kept);
      if (m == null) { pending = true; set({ clash: { mine: p, theirs: kept }, status: "unsaved" }); return; }
      out = m;
    }
    try {
      await field.write(out, mark);
    } catch (e) {
      pending = true;
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (mark.tainted) marked = pending && marked;              // sent with the mark; text typed since is marked still
    const merged = state.merged + (out !== p ? 1 : 0);
    if (pending) { start = p; set({ status: "unsaved", error: null, merged }); return; }   // typed on: it goes on from what was sent
    start = null;
    const now = field.read();
    set({ text: now !== undefined && now !== p && now.trim() === p.trim() ? p : null, status: "saved", error: null, merged });
  }

  /** Whatever is pending, saved now; one save at a time. */
  function flush(): Promise<void> {
    cancel?.(); cancel = undefined;
    return (chain = chain.then(send));
  }

  return {
    get: (): DraftState => state,
    watch(l: () => void): () => void { watchers.add(l); return () => { watchers.delete(l); }; },
    /** Whether something typed waits to be saved. */
    pending: () => pending,
    /** Text typed in. */
    type(text: string): void {
      if (start == null) start = field.read() ?? state.text ?? "";   // what was kept as typing began (the box showed it, or it trimmed)
      pending = true;
      if (arm) { marked = true; arm = false; }
      set({ text, status: "unsaved" });
      cancel?.();
      cancel = schedule(() => { void flush(); }, delay);
    },
    flush,
    /** The text holds someone else's words now (a model's summary put in): the pending text and the next typed in (the insert
     *  may reach the draft after this says so) are saved with the `tainted` mark. One more mark than needed changes nothing:
     *  the server never takes it off. */
    taint(): void { if (pending) marked = true; arm = true; },
    /** A clash settled: mine written over theirs, as the owner chose, or theirs kept and the draft let go. */
    resolve(keep: "mine" | "theirs"): Promise<void> {
      const c = state.clash;
      if (!c) return Promise.resolve();
      if (keep === "theirs") {
        pending = false; start = null; marked = false;
        set({ clash: null, text: null, status: "saved" });
        return Promise.resolve();
      }
      start = c.theirs;                                        // merging from theirs: nothing of theirs left to clash with
      set({ clash: null });
      return flush();
    },
    /** The owner deleted the record: what is pending goes with it. */
    drop(): void {
      cancel?.(); cancel = undefined;
      pending = false; start = null; marked = false; arm = false;
      set({ text: null, status: "saved", clash: null, error: null });
    },
  };
}
