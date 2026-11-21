// The preferences' sync (prefs.ts): the one protocol every writer of the preferences record speaks, over a transport of its
// own: the web's axios (web/src/services/records.ts), the agent's fetch (server/agent/src/prefs.ts). `prefsRemote` is the
// record over a `RecordTransport`; `changePrefs` and `patchPrefs` write it; `prefsSync` is the engine a device's copy runs.
//
// The record holds the whole `data` and carries `rev`, the compare-and-swap of server/pb_hooks/rev.pb.js: a save names the rev
// it read and is refused (a `Conflict`) when another writer saved since. So no writer ever puts back what it hasn't seen: it
// reads again, puts its own change over the newer record and tries once more. A change is paths (`theme`, `notes.sort`,
// `phone.tabs`), never the record: a device holds a copy plus the paths it changed that the server doesn't have yet (`dirty`),
// a change made on the copy at once and its paths marked, and a push puts the copy's values at the dirty paths over the
// record it just read. A pull, or the record arriving over the realtime feed (`take`), takes the server's with the dirty
// paths kept over it. Pushes and pulls run one at a time, in order, so a pull that set out before a push landed can't put
// back what the push replaced.
import { DEFAULT_PREFS, everyPath, patchPaths, prefAt, prefsOf, PREFS_KEY, rebased, withPatch, type Prefs, type PrefsPatch } from "./prefs";
import { Conflict, lit } from "./record-contracts";
import type { RecordTransport } from "./record-protocol";

/** A device's copy: the preferences as it shows them, and the paths changed here and not yet saved. */
export type PrefsCopy = { prefs: Prefs; dirty: string[] };
export type CopyStore = { read: () => PrefsCopy; write: (c: PrefsCopy) => void };

/** The server's record: its id, the `rev` it is at and the preferences in it. */
export type StoredPrefs = { rec: string; rev: number; prefs: Prefs };
export type PrefsRemote = {
  /** The record, or null before any device has saved one. */
  get: () => Promise<StoredPrefs | null>;
  /** `prefs` saved over the record `base` names (the id and rev that were read), or as the record when `base` is null.
   *  A `Conflict` when it has moved on since, or when another writer made the record meanwhile. */
  save: (base: { rec: string; rev: number } | null, prefs: Prefs) => Promise<StoredPrefs>;
};

const RECORDS = "collections/prefs/records";
const RETRIES = 4;

/** The owner's preferences record over `s`. */
export function prefsRemote(s: RecordTransport): PrefsRemote {
  const stored = (r: any): StoredPrefs => ({ rec: String(r.id), rev: typeof r.rev === "number" ? r.rev : 0, prefs: prefsOf(r.data) });
  return {
    async get() {
      const j = await s.request(`${RECORDS}?filter=${encodeURIComponent(`key = ${lit(PREFS_KEY)}`)}&perPage=1&skipTotal=1`);
      return j.items.length ? stored(j.items[0]) : null;
    },
    async save(base, prefs) {
      if (base) return stored(await s.request(`${RECORDS}/${base.rec}`, { method: "PATCH", body: { data: prefs, rev: base.rev } }));
      try { return stored(await s.request(RECORDS, { method: "POST", body: { key: PREFS_KEY, data: prefs } })); } catch (e) {
        // `key` is unique: a 400 here is another device having made the record first
        if (s.answer(e)?.status === 400) throw new Conflict("The preferences record exists already.");
        throw e;
      }
    },
  };
}

/** The server's preferences changed: `change` is given the record's (null before there is one) and returns what to save over
 *  it. A `Conflict` (another writer saved since the read) reads again and asks `change` again, so it is always made over the
 *  newest record. Gives up with that `Conflict` after a few tries. */
export async function changePrefs(remote: PrefsRemote, change: (theirs: Prefs | null) => Prefs): Promise<StoredPrefs> {
  for (let attempt = 1; ; attempt++) {
    const theirs = await remote.get();
    try { return await remote.save(theirs && { rec: theirs.rec, rev: theirs.rev }, change(theirs && theirs.prefs)); } catch (e) {
      if (!(e instanceof Conflict) || attempt >= RETRIES) throw e;
    }
  }
}

/** `patch` over the server's preferences: only the paths it names change. A function is given the current preferences, for a
 *  change that depends on them (a note action added to the list there is). */
export const patchPrefs = (remote: PrefsRemote, patch: PrefsPatch | ((current: Prefs) => PrefsPatch)): Promise<StoredPrefs> =>
  changePrefs(remote, (theirs) => {
    const current = theirs ?? DEFAULT_PREFS;
    return withPatch(current, typeof patch === "function" ? patch(current) : patch);
  });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

export function prefsSync(store: CopyStore, remote: PrefsRemote) {
  let queue: Promise<void> = Promise.resolve();
  /** `run` after whatever is running. A failure (offline, the server down) leaves the copy dirty for the next push or pull. */
  const serial = (run: () => Promise<void>): Promise<void> => (queue = queue.then(run).catch(() => {}));

  /** The server's preferences as the copy: the dirty paths keep this device's values. */
  const take = (theirs: Prefs) => {
    const c = store.read();
    store.write({ prefs: rebased(theirs, c.prefs, c.dirty), dirty: c.dirty });
  };

  const push = () => serial(async () => {
    const sent = store.read();
    if (!sent.dirty.length) return;
    const saved = await changePrefs(remote, (theirs) => (theirs ? rebased(theirs, sent.prefs, sent.dirty) : sent.prefs));
    // A path changed again while this was out stays dirty, for the next push
    const now = store.read();
    const dirty = now.dirty.filter((p) => !sent.dirty.includes(p) || !same(prefAt(sent.prefs, p), prefAt(now.prefs, p)));
    store.write({ prefs: rebased(saved.prefs, now.prefs, dirty), dirty });
  });

  const pull = () => serial(async () => {
    const theirs = await remote.get();
    if (theirs) { take(theirs.prefs); return; }
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
