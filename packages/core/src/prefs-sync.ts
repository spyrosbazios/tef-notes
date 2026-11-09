// The preferences' sync (prefs.ts): the engine a device's copy runs, over a `CopyStore` (where the device keeps its copy: the
// web's localStorage, web/src/hooks/prefs.ts) and a `PrefsRemote` (the server's record), so a bun test can run it on fakes.
//
// The server's record is what every device shares; a device holds a copy plus the paths it changed that the server doesn't have
// yet (`dirty`: `theme`, `notes.sort`, `phone.tabs`). A change is made on the copy at once and its paths marked. A push reads
// the record, puts the copy's values at the dirty paths over it and saves that: a device only ever sends what it changed, so two
// devices changing different preferences never undo each other's (on the same one, the last save wins). A pull, or the record
// arriving over the realtime feed (`take`), takes the server's with the dirty paths kept over it. Pushes and pulls run one at a
// time, in order, so a pull that set out before a push landed can't put back what the push replaced.
import { everyPath, patchPaths, prefAt, rebased, withPatch, type Prefs, type PrefsPatch } from "./prefs";

/** A device's copy: the preferences as it shows them, and the paths changed here and not yet saved. */
export type PrefsCopy = { prefs: Prefs; dirty: string[] };
export type CopyStore = { read: () => PrefsCopy; write: (c: PrefsCopy) => void };

/** The server's record: its id and the preferences in it. */
export type StoredPrefs = { rec: string; prefs: Prefs };
export type PrefsRemote = {
  /** The record, or null before any device has saved one. */
  get: () => Promise<StoredPrefs | null>;
  /** `prefs` saved whole: over `rec`, or as the record when there is none (refused if another device made it meanwhile). */
  save: (rec: string | null, prefs: Prefs) => Promise<StoredPrefs>;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

export function prefsSync(store: CopyStore, remote: PrefsRemote) {
  let queue: Promise<void> = Promise.resolve();
  /** `run` after whatever is running. A failure (offline, the server down) leaves the copy dirty for the next push or pull. */
  const serial = (run: () => Promise<void>): Promise<void> => (queue = queue.then(run).catch(() => {}));

  /** The server's record as the copy: the dirty paths keep this device's values. */
  const take = (s: StoredPrefs) => {
    const c = store.read();
    store.write({ prefs: rebased(s.prefs, c.prefs, c.dirty), dirty: c.dirty });
  };

  const push = () => serial(async () => {
    const sent = store.read();
    if (!sent.dirty.length) return;
    const theirs = await remote.get();
    const saved = await remote.save(theirs?.rec ?? null, theirs ? rebased(theirs.prefs, sent.prefs, sent.dirty) : sent.prefs);
    // A path changed again while this was out stays dirty, for the next push
    const now = store.read();
    const dirty = now.dirty.filter((p) => !sent.dirty.includes(p) || !same(prefAt(sent.prefs, p), prefAt(now.prefs, p)));
    store.write({ prefs: rebased(saved.prefs, now.prefs, dirty), dirty });
  });

  const pull = () => serial(async () => {
    const theirs = await remote.get();
    if (theirs) { take(theirs); return; }
    // No record yet: this copy becomes it
    const c = store.read();
    store.write({ ...c, dirty: union(c.dirty, everyPath(c.prefs)) });
  }).then(() => (store.read().dirty.length ? push() : undefined));

  return {
    /** `patch` on the copy now, its paths marked for the next push (the caller decides when: several quick changes can go as one). */
    set(patch: PrefsPatch) {
      const c = store.read();
      store.write({ prefs: withPatch(c.prefs, patch), dirty: union(c.dirty, patchPaths(patch)) });
    },
    take,
    /** Sends the copy's dirty paths, if any. */
    push,
    /** Fetches the record into the copy, then sends what is still dirty. */
    pull,
  };
}
