import { describe, expect, test } from "bun:test";
import { DEFAULT_PREFS, prefsOf, withPatch, type Prefs, type PrefsPatch } from "../src/prefs";
import { changePrefs, patchPrefs, prefsRemote, prefsSync, type PrefsCopy, type PrefsRemote, type StoredPrefs } from "../src/prefs-sync";
import { Conflict } from "../src/record-contracts";
import type { RecordTransport } from "../src/record-protocol";

/** A server holding one record under the rev contract, and a device's copy, as plain objects. `meanwhile` runs once ahead of
 *  the next save: another writer's save landing between a device's read and its write. */
function world(start: Prefs | null) {
  const server = {
    rec: start ? { rec: "r1", rev: 1, prefs: start } as StoredPrefs | null : null, saves: 0, down: false, conflicts: 0,
    meanwhile: undefined as (() => void) | undefined,
  };
  const remote: PrefsRemote = {
    get: async () => { if (server.down) throw new Error("down"); return server.rec && { ...server.rec }; },
    save: async (base, prefs) => {
      if (server.down) throw new Error("down");
      const hook = server.meanwhile;
      server.meanwhile = undefined;
      hook?.();
      if (base ? !server.rec || base.rev !== server.rec.rev : server.rec) { server.conflicts++; throw new Conflict("moved"); }
      server.saves++;
      server.rec = { rec: base?.rec ?? "r1", rev: (server.rec?.rev ?? 0) + 1, prefs: prefsOf(JSON.parse(JSON.stringify(prefs))) };
      return { ...server.rec };
    },
  };
  return { server, remote };
}

/** Another device saving `patch` over whatever the record is by then, as the web would. */
const elsewhere = (server: ReturnType<typeof world>["server"], patch: PrefsPatch) => () => {
  const r = server.rec!;
  server.rec = { rec: r.rec, rev: r.rev + 1, prefs: withPatch(r.prefs, patch) };
};

function device(remote: PrefsRemote, prefs = DEFAULT_PREFS) {
  let copy: PrefsCopy = { prefs, dirty: [] };
  const sync = prefsSync({ read: () => copy, write: (c) => { copy = c; } }, remote);
  return { sync, copy: () => copy };
}

describe("prefsSync", () => {
  test("a change shows at once and goes up as only what changed", async () => {
    const { server, remote } = world(withPatch(DEFAULT_PREFS, { theme: "dawn" }));
    const d = device(remote);
    d.sync.set({ accent: "rose" });
    expect(d.copy()).toMatchObject({ prefs: { accent: "rose" }, dirty: ["accent"] });
    await d.sync.push();
    // The server's theme, which this copy never had, survives the push
    expect(server.rec?.prefs).toMatchObject({ theme: "dawn", accent: "rose" });
    expect(d.copy()).toMatchObject({ prefs: { theme: "dawn", accent: "rose" }, dirty: [] });
  });

  test("two devices changing different preferences keep both", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const phone = device(remote), laptop = device(remote);
    phone.sync.set({ phone: { tabLabels: "never" } });
    laptop.sync.set({ desktop: { hidden: ["logbook"] } });
    await laptop.sync.push();
    await phone.sync.push();
    expect(server.rec?.prefs.phone.tabLabels).toBe("never");
    expect(server.rec?.prefs.desktop.hidden).toEqual(["logbook"]);
    await laptop.sync.pull();
    expect(laptop.copy().prefs.phone.tabLabels).toBe("never");
  });

  test("a pull keeps what is unsent", async () => {
    const { remote } = world(withPatch(DEFAULT_PREFS, { theme: "dawn", notes: { sort: "created" } }));
    const d = device(remote);
    d.sync.set({ notes: { grouped: true } });
    d.sync.take(withPatch(DEFAULT_PREFS, { theme: "dawn", notes: { sort: "created" } }));
    expect(d.copy().prefs.notes).toEqual({ grouped: true, collapsed: [], sort: "created" });
    expect(d.copy().dirty).toEqual(["notes.grouped"]);
  });

  test("a change made while a push is out stays dirty", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: PrefsRemote = { ...remote, save: async (base, p) => { await gate; return remote.save(base, p); } };
    const d = device(slow);
    d.sync.set({ theme: "dawn" });
    const out = d.sync.push();
    await Promise.resolve();
    d.sync.set({ theme: "forest", accent: "rose" });
    release();
    await out;
    expect(server.rec?.prefs.theme).toBe("dawn");
    expect(d.copy()).toMatchObject({ prefs: { theme: "forest", accent: "rose" } });
    expect([...d.copy().dirty].sort()).toEqual(["accent", "theme"]);
    await d.sync.push();
    expect(server.rec?.prefs).toMatchObject({ theme: "forest", accent: "rose" });
  });

  test("offline: the change waits, and the next pull sends it", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const d = device(remote);
    server.down = true;
    d.sync.set({ lens: "work" });
    await d.sync.push();
    expect(d.copy().dirty).toEqual(["lens"]);
    server.down = false;
    await d.sync.pull();
    expect(server.rec?.prefs.lens).toBe("work");
    expect(d.copy().dirty).toEqual([]);
  });

  test("the first device makes the record from its copy", async () => {
    const { server, remote } = world(null);
    const d = device(remote, withPatch(DEFAULT_PREFS, { theme: "dawn" }));
    await d.sync.pull();
    expect(server.rec).toEqual({ rec: "r1", rev: 1, prefs: withPatch(DEFAULT_PREFS, { theme: "dawn" }) });
    expect(d.copy().dirty).toEqual([]);
  });

  test("nothing changed, nothing sent", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const d = device(remote);
    await d.sync.pull();
    await d.sync.push();
    expect(server.saves).toBe(0);
  });
});

describe("two writers, one record", () => {
  test("a device whose save lost the race reads again and keeps both: its paths over the newer record", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const phone = device(remote);
    phone.sync.set({ phone: { tabLabels: "never" }, theme: "dawn" });
    server.meanwhile = elsewhere(server, { desktop: { hidden: ["logbook"] }, theme: "forest", accent: "rose" });
    await phone.sync.push();
    expect(server.conflicts).toBe(1);
    // The other device's untouched paths survive; on the one both changed, the phone's last word stands
    expect(server.rec?.prefs).toMatchObject({ theme: "dawn", accent: "rose", desktop: { hidden: ["logbook"] }, phone: { tabLabels: "never" } });
    expect(server.rec?.rev).toBe(3);
    expect(phone.copy()).toMatchObject({ dirty: [], prefs: { accent: "rose", desktop: { hidden: ["logbook"] } } });
  });

  test("two devices pushing different paths at the same moment keep both", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const phone = device(remote), laptop = device(remote);
    phone.sync.set({ phone: { tabLabels: "never" } });
    laptop.sync.set({ desktop: { hidden: ["logbook"] } });
    await Promise.all([phone.sync.push(), laptop.sync.push()]);
    expect(server.conflicts).toBe(1);
    expect(server.rec?.prefs.phone.tabLabels).toBe("never");
    expect(server.rec?.prefs.desktop.hidden).toEqual(["logbook"]);
    expect(server.rec?.rev).toBe(3);
  });

  test("gives up after a few conflicts, leaving the copy dirty", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const d = device(remote);
    d.sync.set({ theme: "dawn" });
    const bump = () => { elsewhere(server, { accent: "rose" })(); server.meanwhile = bump; };
    server.meanwhile = bump;
    await d.sync.push();
    expect(server.conflicts).toBe(4);
    expect(d.copy().dirty).toEqual(["theme"]);
    expect(server.rec?.prefs.theme).toBe(DEFAULT_PREFS.theme);
  });

  test("the agent's patch: the lens goes over a record a device changed meanwhile", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    server.meanwhile = elsewhere(server, { theme: "dawn" });
    await patchPrefs(remote, { lens: "work" });
    expect(server.rec?.prefs).toMatchObject({ lens: "work", theme: "dawn" });
  });

  test("a patch that depends on the current preferences is made again over the newer ones", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    const seen: string[][] = [];
    server.meanwhile = elsewhere(server, { notes: { collapsed: ["a"] } });
    await patchPrefs(remote, (p) => { seen.push(p.notes.collapsed); return { notes: { collapsed: [...p.notes.collapsed, "b"] } }; });
    expect(seen).toEqual([[], ["a"]]);
    expect(server.rec?.prefs.notes.collapsed).toEqual(["a", "b"]);
  });

  test("the first save of two writers at once makes one record, the second goes over it", async () => {
    const { server, remote } = world(null);
    server.meanwhile = () => { server.rec = { rec: "r1", rev: 1, prefs: withPatch(DEFAULT_PREFS, { theme: "forest" }) }; };
    const saved = await changePrefs(remote, (theirs) => withPatch(theirs ?? DEFAULT_PREFS, { accent: "rose" }));
    expect(saved).toMatchObject({ rev: 2, prefs: { theme: "forest", accent: "rose" } });
  });
});

/** PocketBase's `prefs` collection behind a RecordTransport: the unique key and the rev contract (a stale rev is a Conflict). */
function pocketbase() {
  const state = { rec: null as { id: string; key: string; rev: number; data: unknown } | null, requests: [] as { path: string; method: string; body?: any }[] };
  const transport: RecordTransport = {
    status: (e) => (e as { status?: number }).status,
    async request(path, req = {}) {
      const method = req.method ?? "GET", body = req.body as any;
      state.requests.push({ path, method, body });
      if (method === "GET") return { items: state.rec ? [state.rec] : [] };
      if (method === "POST") {
        if (state.rec) throw Object.assign(new Error("not unique"), { status: 400 });
        state.rec = { id: "r1", key: body.key, rev: 1, data: body.data };
        return state.rec;
      }
      if (!state.rec || body.rev !== state.rec.rev) throw new Conflict("stale");
      state.rec = { ...state.rec, rev: state.rec.rev + 1, data: body.data };
      return state.rec;
    },
  };
  return { state, transport };
}

describe("prefsRemote", () => {
  test("reads the owner's record with its rev; none is null", async () => {
    const { state, transport } = pocketbase();
    const remote = prefsRemote(transport);
    expect(await remote.get()).toBeNull();
    state.rec = { id: "r1", key: "owner", rev: 5, data: { theme: "dawn" } };
    expect(await remote.get()).toMatchObject({ rec: "r1", rev: 5, prefs: { theme: "dawn" } });
    expect(decodeURIComponent(state.requests[0].path)).toContain('key = "owner"');
  });

  test("saves over the rev it read, and as the record when there is none", async () => {
    const { state, transport } = pocketbase();
    const remote = prefsRemote(transport);
    expect(await remote.save(null, DEFAULT_PREFS)).toMatchObject({ rec: "r1", rev: 1 });
    expect(state.requests.at(-1)).toMatchObject({ method: "POST", body: { key: "owner" } });
    expect(await remote.save({ rec: "r1", rev: 1 }, withPatch(DEFAULT_PREFS, { lens: "w" }))).toMatchObject({ rev: 2, prefs: { lens: "w" } });
    expect(state.requests.at(-1)).toMatchObject({ method: "PATCH", body: { rev: 1 } });
    await expect(remote.save({ rec: "r1", rev: 1 }, DEFAULT_PREFS)).rejects.toBeInstanceOf(Conflict);
  });

  test("a second first save is a Conflict, not a failure", async () => {
    const { state, transport } = pocketbase();
    state.rec = { id: "r1", key: "owner", rev: 1, data: {} };
    await expect(prefsRemote(transport).save(null, DEFAULT_PREFS)).rejects.toBeInstanceOf(Conflict);
  });

  test("a stale save through the whole stack goes over the newer record", async () => {
    const { state, transport } = pocketbase();
    state.rec = { id: "r1", key: "owner", rev: 1, data: withPatch(DEFAULT_PREFS, { theme: "dawn" }) };
    const remote = prefsRemote(transport), get = remote.get;
    let raced = false;
    remote.get = async () => {
      const s = await get();
      if (!raced) { raced = true; state.rec = { ...state.rec!, rev: 2, data: withPatch(DEFAULT_PREFS, { theme: "dawn", accent: "rose" }) }; }
      return s;
    };
    await patchPrefs(remote, { lens: "w" });
    expect(state.rec).toMatchObject({ rev: 3, data: { theme: "dawn", accent: "rose", lens: "w" } });
  });
});
