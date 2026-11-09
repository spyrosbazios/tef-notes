import { describe, expect, test } from "bun:test";
import { DEFAULT_PREFS, prefsOf, withPatch, type Prefs } from "../src/prefs";
import { prefsSync, type PrefsCopy, type PrefsRemote, type StoredPrefs } from "../src/prefs-sync";

/** A server holding one record, and a device's copy, as plain objects. */
function world(start: Prefs | null) {
  const server = { rec: start ? { rec: "r1", prefs: start } as StoredPrefs | null : null, saves: 0, down: false };
  const remote: PrefsRemote = {
    get: async () => { if (server.down) throw new Error("down"); return server.rec && { ...server.rec }; },
    save: async (rec, prefs) => {
      if (server.down) throw new Error("down");
      if (!rec && server.rec) throw new Error("exists");
      server.saves++;
      server.rec = { rec: rec ?? "r1", prefs: prefsOf(JSON.parse(JSON.stringify(prefs))) };
      return { ...server.rec };
    },
  };
  return { server, remote };
}

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
    await d.sync.take({ rec: "r1", prefs: withPatch(DEFAULT_PREFS, { theme: "dawn", notes: { sort: "created" } }) });
    expect(d.copy().prefs.notes).toEqual({ grouped: true, collapsed: [], sort: "created" });
    expect(d.copy().dirty).toEqual(["notes.grouped"]);
  });

  test("a change made while a push is out stays dirty", async () => {
    const { server, remote } = world(DEFAULT_PREFS);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: PrefsRemote = { ...remote, save: async (rec, p) => { await gate; return remote.save(rec, p); } };
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
    expect(server.rec).toEqual({ rec: "r1", prefs: withPatch(DEFAULT_PREFS, { theme: "dawn" }) });
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
