// The drawing editor's life, apart from React so it is tested on its own (web/test/drawing-store.test.ts); hooks/drawing.ts holds
// the window's one store and its hooks. What it decides:
//  - which drawing is open, over which note, and whether its canvas holds changes not saved yet (the canvas says, each time
//    that flips);
//  - closing it goes through `requestClose`, always: with nothing unsaved it closes, otherwise it asks the owner once (`asking`,
//    the layer's dialog) and every caller waiting meanwhile (the Close button, a navigation away, another drawing opening) gets
//    the same answer;
//  - saving goes through `save`, always: one save at a time, shared by ⌘S, the Save button and the assistant's save_drawing, so
//    a held ⌘S or a ⌘S beside save_drawing never makes a drawing twice; a saved drawing with nothing new isn't uploaded again.

/** The drawing open in the editor: the note it is in (by id), its file (null: new, not saved yet). `seq` tells two openings of
 *  the same drawing apart, so a second one reloads it. */
export type Opened = { noteId: string; name: string | null; seq: number };

/** A save's outcome: why not, or the drawing's file. */
export type Saved = { error: string } | { name: string };

export type DrawingState = {
  opened: Opened | null;
  /** The open canvas holds changes not saved yet. */
  unsaved: boolean;
  /** A close waits on the owner: keep drawing, or close without saving. */
  asking: boolean;
  saving: boolean;
};

/** The editor's Save as the layer does it, for one opening: the canvas's scene uploaded under `name` (null: made new). */
export type Saver = { seq: number; save: (name: string | null) => Promise<Saved> };

export function drawingStore() {
  let state: DrawingState = { opened: null, unsaved: false, asking: false, saving: false };
  let seq = 0, saver: Saver | null = null, saving: Promise<Saved> | null = null;
  let question: { promise: Promise<boolean>; answer: (leave: boolean) => void } | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DrawingState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

  const close = () => {
    const q = question;
    question = null;
    set({ opened: null, unsaved: false, asking: false });
    q?.answer(true);
  };

  /** Close the editor, asking first if changes would be lost; true once it is closed, false when the owner kept it. */
  const requestClose = (): Promise<boolean> => {
    if (!state.opened) return Promise.resolve(true);
    if (!state.unsaved) { close(); return Promise.resolve(true); }
    if (!question) {
      let answer!: (leave: boolean) => void;
      const promise = new Promise<boolean>((done) => { answer = done; });
      question = { promise, answer };
      set({ asking: true });
    }
    return question.promise;
  };

  return {
    get: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    requestClose,
    /** The owner's answer to the question `requestClose` asked: `leave` closes without saving. */
    answer(leave: boolean) {
      if (!question) return;
      if (leave) { close(); return; }
      const q = question;
      question = null;
      set({ asking: false });
      q.answer(false);
    },
    /** Opens a drawing of the note (its file, or null for a new one), once whatever is open has closed (asking first if it holds
     *  unsaved changes); the opening's `seq`, or null when the owner kept the other one. */
    async open(noteId: string, name: string | null): Promise<number | null> {
      if (!(await requestClose())) return null;
      set({ opened: { noteId, name, seq: ++seq }, unsaved: false });
      return seq;
    },
    /** The canvas of opening `at` says whether it holds unsaved changes (false as it goes: what it held is gone with it). */
    markUnsaved(at: number, unsaved: boolean) {
      if (state.opened?.seq === at && state.unsaved !== unsaved) set({ unsaved });
    },
    /** The drawing a new one became once saved: the editor stays on it. */
    savedAs(name: string) { if (state.opened) set({ opened: { ...state.opened, name } }); },
    /** The layer registers its Save while it is up (null when it goes). */
    setSaver(s: Saver | null) { saver = s; },
    saverNow: () => saver,
    /** Saves the open drawing: the save already running if one is, else a new one (nothing uploaded when nothing changed). */
    save(): Promise<Saved> {
      if (saving) return saving;
      const o = state.opened;
      if (!o || saver?.seq !== o.seq) return Promise.resolve({ error: "No drawing is open." });
      if (o.name && !state.unsaved) return Promise.resolve({ name: o.name });
      set({ saving: true });
      // Cleared on the stored promise: a save that finishes at once must not leave `saving` set (AGENTS.md footgun)
      const run = saver.save(o.name).finally(() => { if (saving === run) saving = null; set({ saving: false }); });
      saving = run;
      return run;
    },
  };
}

export type DrawingStore = ReturnType<typeof drawingStore>;
