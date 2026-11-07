// The sync engine in store/notes.ts against a fake notes server and an in-memory db.ts: what gets pulled,
// merged, raised, deleted or sent — and that a server out of reach costs nothing. The fake keeps PocketBase's
// contract (server/pb_hooks/rev.pb.js): unique paths, compare-and-swap on rev, rev 1 on create.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/core/http";
import { parseNote, serializeNote } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import { moveAttachments } from "@/store/attachments";
import type { NoteRow } from "@/store/db";
import { useKeys } from "@/store/keys";
import { dirty, heard, photosFrom, reloadNotes, setServer, syncNotes, useNotes } from "@/store/notes";
import { fake } from "./helpers";

vi.mock("@/store/db", async () => (await import("./helpers")).fake);
vi.mock("@/store/storage", async () => (await import("./helpers")).fakeStorage);
vi.mock("expo-secure-store", () => ({ getItem: () => null, setItem: () => {}, deleteItemAsync: async () => {} }));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("@/store/live", () => ({ useLive: () => {} }));
vi.mock("@/store/attachments", () => ({ syncAttachments: async () => {}, moveAttachments: vi.fn() }));   // its own tests: test/attachments.test.ts
vi.mock("@/core/pocketbase", async (orig) => ({
  ...(await orig<typeof import("@/core/pocketbase")>()),
  list: vi.fn(), get: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), photos: vi.fn(),
}));

const A = "notes/20261001-shopping.md", B = "notes/20261002-garage.md", M = "agent/memory.md";
const doc = (title: string, body: string, flags = {}) => serializeNote({ title, created: "2026-10-01", ...flags }, body);
const S = { url: "https://n" };

// ---- the fake server: path → record

const srv = new Map<string, Omit<pb.Remote, "kind"> & { kind?: pb.Remote["kind"] }>();
let ids = 0;
const byRec = (rec: string) => [...srv.values()].find((r) => r.rec === rec);
/** What the server holds: path → text, or [text, rev, rec]. */
const server = (files: Record<string, string | [string, number, string]>) => {
  srv.clear();
  for (const [path, f] of Object.entries(files)) {
    const [text, rev, rec] = typeof f === "string" ? [f, 1, `r${++ids}`] : f;
    srv.set(path, { rec, path, rev, text });
  }
};
const at = (path: string) => srv.get(path);
const fakeServer = () => {
  vi.mocked(pb.list).mockImplementation(async () => [...srv.values()].map(({ rec, path, rev, kind = "note" }) => ({ rec, path, rev, kind })));
  const remote = (r: ReturnType<typeof byRec>): pb.Remote | null => (r ? { kind: "note", ...structuredClone(r) } : null);
  vi.mocked(pb.get).mockImplementation(async (_s, rec) => remote(byRec(rec)));
  vi.mocked(pb.read).mockImplementation(async (_s, path) => remote(srv.get(path)));
  vi.mocked(pb.create).mockImplementation(async (_s, path, text) => {
    if (srv.has(path)) throw new pb.Conflict(path);
    const r = { rec: `r${++ids}`, path, rev: 1, text, kind: "note" as const };
    srv.set(path, r);
    return { ...r };
  });
  vi.mocked(pb.update).mockImplementation(async (_s, e, text) => {
    const cur = byRec(e.rec);
    if (!cur) return null;
    if (cur.rev !== e.rev) throw new pb.Conflict(e.path);
    Object.assign(cur, { text, rev: cur.rev + 1 });
    return { kind: "note", ...cur };
  });
  vi.mocked(pb.remove).mockImplementation(async (_s, e) => {
    const cur = byRec(e.rec);
    if (!cur) return;
    if (cur.rev !== e.rev) throw new pb.Conflict(cur.path);
    srv.delete(cur.path);
  });
  vi.mocked(pb.photos).mockResolvedValue([]);
};

// ---- the phone

/** A row in step with the server's record `rec` at `rev`; `p` to make it otherwise. */
const row = (path: string, text: string, p: Partial<NoteRow> = {}): NoteRow => {
  const n = parseNote(path, text);
  return {
    path, id: n.id, text, title: n.title, created: n.created, pinned: n.pinned, color: n.color ?? null, tags: n.tags, kind: "note", snippet: "",
    updated: 1, pushed: 1, rec: `rec-${n.id}`, rev: 1, base: text, conflict_text: null, conflict_rev: null, lost: null, deleted: false, ...p,
  };
};
const edited = (path: string, base: string, text: string, p: Partial<NoteRow> = {}) => row(path, text, { base, updated: 2, ...p });
const seed = (...rows: NoteRow[]) => { for (const r of rows) fake.putNote(r); reloadNotes(); };
const N = (path: string) => fake.getNote(path);
const settle = () => vi.waitFor(() => expect(useNotes.getState().sync.state).not.toBe("syncing"));

beforeEach(() => {
  vi.resetAllMocks();
  fake.reset();
  srv.clear();
  fakeServer();
  useKeys.setState({ keys: { server: S.url } });
  useNotes.setState({ notes: {}, list: [], rev: {}, moved: {}, sync: { state: "idle" } });
  vi.mocked(moveAttachments).mockReturnValue([]);
});

describe("pull", () => {
  it("takes every note and agent/memory.md from one listing", async () => {
    server({ [A]: doc("Shopping", "- milk\n", { pinned: true }), [B]: doc("Garage", "1234\n"), [M]: "# Memory\n" });
    await syncNotes();
    expect(fake.allPaths().sort()).toEqual([M, A, B].sort());
    expect(N(A)).toMatchObject({ title: "Shopping", pinned: true, rec: at(A)!.rec, rev: 1, base: N(A)!.text });
    expect(dirty(useNotes.getState().notes[A])).toBe(false);
    expect(useNotes.getState().list.map((m) => m.path)).toEqual([A, B]);           // memory is in the index, not the list
    expect(useNotes.getState().notes[M]).toMatchObject({ title: "Memory", dirty: false });
    expect(N(B)!.updated).toBe(new Date(2026, 9, 1).getTime());                   // a first pull lists notes by age
    expect(useNotes.getState().sync.state).toBe("idle");
  });

  it("fetches only records whose rev moved, and drops ones gone from the server unless edited here", async () => {
    const old = doc("Garage", "1234\n");
    seed(row(A, doc("Shopping", "- milk\n"), { rec: "ra" }), row(B, old, { rec: "rb" }), edited("notes/20261003-gone-edited.md", "x\n", "y\n", { rec: "rx" }),
      row("notes/20261003-gone.md", "z\n", { rec: "rz" }));
    server({ [A]: [doc("Shopping", "- milk\n"), 1, "ra"], [B]: [doc("Garage", "4321\n"), 2, "rb"] });
    await syncNotes();
    expect(pb.get).toHaveBeenCalledTimes(1);
    expect(pb.get).toHaveBeenCalledWith(expect.anything(), "rb");
    expect(N(B)).toMatchObject({ text: doc("Garage", "4321\n"), rev: 2, base: doc("Garage", "4321\n") });
    expect(useNotes.getState().rev[B]).toBeGreaterThan(0);                         // an open note re-reads
    expect(N("notes/20261003-gone.md")).toBeNull();
    expect(useNotes.getState().notes["notes/20261003-gone.md"]).toBeUndefined();
    expect(at("notes/20261003-gone-edited.md")).toMatchObject({ text: "y\n", rev: 1 });   // the edit put it back
    expect(N("notes/20261003-gone-edited.md")).toMatchObject({ rec: at("notes/20261003-gone-edited.md")!.rec, rev: 1 });
  });

  it("keeps what was typed while the read was out; the push raises it", async () => {
    seed(row(A, "old\n", { rec: "ra" }));
    server({ [A]: ["remote\n", 2, "ra"] });
    let answer!: () => void;
    const read = vi.mocked(pb.get).getMockImplementation()!;
    vi.mocked(pb.get).mockImplementationOnce((s, rec) => new Promise((ok) => { answer = () => ok(read(s, rec)); }));
    const done = syncNotes();
    await vi.waitFor(() => expect(pb.get).toHaveBeenCalled());
    useNotes.getState().write(A, "typed\n");
    answer();
    await done;
    expect(N(A)).toMatchObject({ text: "typed\n", conflict_text: "remote\n", conflict_rev: 2 });
    expect(useNotes.getState().sync).toMatchObject({ state: "conflict", conflicts: 1 });
    expect(at(A)).toMatchObject({ text: "remote\n", rev: 2 });                       // nothing written over
  });

  it("records photos from the listing without their bytes", () => {
    fake.putAttachment({ note_id: "n", name: "same.jpg", rec: "p1", file: "f1", local: "file:///same.jpg", size: 5, pushed: 1 });
    fake.putAttachment({ note_id: "n", name: "replaced.jpg", rec: "p2", file: "f2", local: "file:///replaced.jpg", size: 5, pushed: 1 });
    fake.putAttachment({ note_id: "n", name: "gone.jpg", rec: "p3", file: "f3", local: "file:///gone.jpg", size: 5, pushed: 1 });
    fake.putAttachment({ note_id: "n", name: "new-here.jpg", rec: null, file: null, local: "file:///new.jpg", size: 5, pushed: null });
    photosFrom([
      { rec: "p1", note: "n", name: "same.jpg", file: "f1" }, { rec: "p9", note: "n", name: "replaced.jpg", file: "f9" },
      { rec: "q1", note: "m", name: "fresh.jpg", file: "g1" },
    ]);
    expect(fake.getAttachments("n").map((a) => [a.name, a.rec, a.local])).toEqual([
      ["same.jpg", "p1", "file:///same.jpg"], ["replaced.jpg", "p9", null], ["new-here.jpg", null, "file:///new.jpg"],
    ]);
    expect(fake.getAttachment("m", "fresh.jpg")).toMatchObject({ rec: "q1", file: "g1", local: null });
  });
});

describe("push", () => {
  it("sends an edit with the rev it was based on", async () => {
    server({ [A]: [doc("Shopping", "- milk\n"), 1, "ra"] });
    seed(row(A, doc("Shopping", "- milk\n"), { rec: "ra" }));
    useNotes.getState().write(A, doc("Shopping", "- milk\n- eggs\n"));
    expect(useNotes.getState().notes[A].dirty).toBe(true);
    await syncNotes();
    expect(pb.update).toHaveBeenLastCalledWith(expect.anything(), { rec: "ra", path: A, rev: 1 }, doc("Shopping", "- milk\n- eggs\n"));
    expect(at(A)).toMatchObject({ text: doc("Shopping", "- milk\n- eggs\n"), rev: 2 });
    expect(N(A)).toMatchObject({ rev: 2, base: doc("Shopping", "- milk\n- eggs\n") });
    expect(useNotes.getState().notes[A].dirty).toBe(false);
  });

  it("creates the agent's memory like any record", async () => {
    useNotes.getState().write(M, "# Memory\n\nlikes lists\n");
    await syncNotes();
    expect(pb.create).toHaveBeenLastCalledWith(expect.anything(), M, "# Memory\n\nlikes lists\n");
    expect(N(M)).toMatchObject({ rec: at(M)!.rec, rev: 1 });
  });

  it("a stale rev with disjoint edits merges and sends the merge", async () => {
    const base = doc("Shopping", "milk\n\neggs\n"), theirs = doc("Shopping", "milk\n\neggs, a dozen\n");
    seed(edited(A, base, doc("Shopping", "milk\n\neggs\n", { pinned: true }), { rec: "ra" }));
    server({ [A]: [theirs, 2, "ra"] });
    await syncNotes();
    const merged = doc("Shopping", "milk\n\neggs, a dozen\n", { pinned: true });
    expect(at(A)).toMatchObject({ text: merged, rev: 3 });
    expect(N(A)).toMatchObject({ text: merged, rev: 3, base: merged, conflict_rev: null });
    expect(useNotes.getState().notes[A]).toMatchObject({ pinned: true, dirty: false, conflict: false });
    expect(useNotes.getState().sync.state).toBe("idle");
  });

  it("a stale rev with overlapping edits is a conflict; Use the server's keeps mine restorable, Restore sends it", async () => {
    seed(edited(A, "a\n", "mine\n", { rec: "ra" }));
    server({ [A]: ["theirs\n", 2, "ra"] });
    await syncNotes();
    expect(useNotes.getState().sync).toMatchObject({ state: "conflict", conflicts: 1 });
    expect(useNotes.getState().notes[A]).toMatchObject({ conflict: true, dirty: true });
    const { takeTheirs, keepMine, restore } = useNotes.getState();
    takeTheirs(A); takeTheirs(A); keepMine(A);                                     // extra taps are no-ops
    expect(N(A)).toMatchObject({ text: "theirs\n", rev: 2, base: "theirs\n", lost: "mine\n", conflict_rev: null });
    expect(useNotes.getState().notes[A]).toMatchObject({ dirty: false, conflict: false, lost: true });
    expect(useNotes.getState().sync.state).toBe("idle");
    restore(A);
    await settle();
    expect(at(A)).toMatchObject({ text: "mine\n", rev: 3 });
    expect(N(A)).toMatchObject({ text: "mine\n", rev: 3, lost: null });
    expect(useNotes.getState().notes[A].lost).toBeUndefined();
  });

  it("Keep mine sends mine over the server's version", async () => {
    server({ [A]: ["theirs\n", 2, "ra"] });
    seed(edited(A, "a\n", "mine\n", { rec: "ra", conflict_text: "theirs\n", conflict_rev: 2 }));
    useNotes.getState().keepMine(A); useNotes.getState().keepMine(A);
    await settle();
    expect(pb.update).toHaveBeenCalledTimes(1);
    expect(at(A)).toMatchObject({ text: "mine\n", rev: 3 });
    expect(N(A)).toMatchObject({ rev: 3, base: "mine\n", conflict_rev: null });
  });

  it("a delete goes out with the last rev, then the row goes; never-pushed notes just go", async () => {
    server({ [A]: [doc("Shopping", "x\n"), 1, "ra"] });
    seed(row(A, doc("Shopping", "x\n"), { rec: "ra" }));
    const p = useNotes.getState().create("Draft", { body: "x\n" });
    useNotes.getState().remove(p);
    expect(fake.getNote(p)).toBeNull();
    useNotes.getState().remove(A);
    expect(N(A)).toMatchObject({ deleted: true });
    expect(useNotes.getState().notes[A]).toBeUndefined();
    await settle();
    expect(pb.remove).toHaveBeenCalledTimes(1);
    expect(pb.remove).toHaveBeenCalledWith(expect.anything(), { rec: "ra", rev: 1 });
    expect(at(A)).toBeUndefined();
    expect(N(A)).toBeNull();
    expect(pb.create).not.toHaveBeenCalled();
  });

  it("a note deleted while its first upload is out is taken down again once it lands, not brought back", async () => {
    const p = useNotes.getState().create("Draft", { body: "x\n" });
    let land!: () => void;
    const make = vi.mocked(pb.create).getMockImplementation()!;
    vi.mocked(pb.create).mockImplementationOnce((s, path, text) => new Promise((ok) => { land = () => ok(make(s, path, text)); }));
    const run = syncNotes();
    await vi.waitFor(() => expect(pb.create).toHaveBeenCalledWith(expect.anything(), p, expect.any(String)));
    useNotes.getState().remove(p);
    expect(N(p)).toMatchObject({ deleted: true, rec: null });                       // a tombstone: the upload may yet land
    expect(useNotes.getState().notes[p]).toBeUndefined();
    land();
    await run;
    await settle();
    expect(pb.remove).toHaveBeenCalledWith(expect.anything(), { rec: expect.any(String), rev: 1 });
    expect(at(p)).toBeUndefined();
    expect(N(p)).toBeNull();
  });

  it("a note made here at a path the laptop took first goes up under a fresh one; both notes live", async () => {
    const mine = doc("Shopping", "- milk\n![](../attachments/20261001-shopping/a.jpg)\n", { pinned: true }), theirs = doc("Shopping", "- the laptop's list\n");
    const A2 = "notes/20261001-shopping-2.md";
    seed(row(A, mine, { rec: null, rev: null, base: null, pushed: null, updated: 2 }));
    server({ [A]: [theirs, 1, "rl"] });
    vi.mocked(moveAttachments).mockReturnValue(["a.jpg"]);                         // added here, not uploaded: it goes along
    await syncNotes();
    const moved = mine.replace("attachments/20261001-shopping/", "attachments/20261001-shopping-2/");
    expect(moveAttachments).toHaveBeenCalledWith("20261001-shopping", "20261001-shopping-2");
    expect(at(A)).toMatchObject({ text: theirs, rev: 1 });                          // never over the laptop's
    expect(at(A2)).toMatchObject({ text: moved, rev: 1 });
    expect(N(A)).toBeNull();                                                        // this sync's pull ran first: the next one brings it
    expect(N(A2)).toMatchObject({ text: moved, pinned: true, rev: 1, base: moved, conflict_rev: null });
    expect(useNotes.getState().notes[A2]).toMatchObject({ pinned: true, dirty: false, conflict: false });
    expect(useNotes.getState().sync.state).toBe("idle");
    // A save from a screen still open on the old path follows the note; the next pull brings the laptop's in
    useNotes.getState().write(A, moved.replace("- milk", "- milk\n- eggs"));
    expect(N(A)).toBeNull();
    expect(N(A2)!.text).toContain("- eggs");
    await syncNotes();
    expect(N(A)).toMatchObject({ text: theirs, rec: "rl" });
    expect(at(A2)!.text).toContain("- eggs");
  });

  it("the same text already at that path is this note's own upload, not the laptop's: no move", async () => {
    const mine = doc("Shopping", "- milk\n");
    seed(row(A, mine, { rec: null, rev: null, base: null, pushed: null, updated: 2 }));
    vi.mocked(pb.list).mockResolvedValueOnce([]);                                  // the upload landed after this pull listed
    server({ [A]: [mine, 1, "ra"] });
    await syncNotes();
    expect(N(A)).toMatchObject({ rec: "ra", rev: 1, base: mine });
    expect(useNotes.getState().notes[A].dirty).toBe(false);
    expect(fake.allPaths()).toEqual([A]);
  });

  it("a delete of a note edited on the server since brings it back with that edit", async () => {
    seed(row(A, doc("Shopping", "x\n"), { rec: "ra", deleted: true }));
    server({ [A]: [doc("Shopping", "x, edited\n"), 2, "ra"] });
    await syncNotes();
    expect(N(A)).toMatchObject({ deleted: false, text: doc("Shopping", "x, edited\n"), rev: 2 });
    expect(useNotes.getState().notes[A]).toMatchObject({ dirty: false });
    expect(at(A)).toBeDefined();
  });

  it("a delete already done on the server just clears the tombstone", async () => {
    seed(row(A, "x\n", { rec: "ra", deleted: true }));
    await syncNotes();
    expect(N(A)).toBeNull();
    expect(pb.remove).not.toHaveBeenCalled();
  });

  it("a server out of reach leaves everything as it was", async () => {
    const down = new TypeError("Network request failed");
    seed(row(A, doc("Shopping", "x\n"), { rec: "ra" }), edited(B, "a\n", "b\n", { rec: "rb" }), row("notes/20261003-c.md", "c\n", { rec: "rc", deleted: true }));
    const before = structuredClone([...fake.notes.values()]);
    for (const f of [pb.list, pb.get, pb.read, pb.create, pb.update, pb.remove]) vi.mocked(f).mockRejectedValue(down);
    await syncNotes();
    expect([...fake.notes.values()]).toEqual(before);
    expect(useNotes.getState().notes[B]).toMatchObject({ dirty: true });
    expect(useNotes.getState().sync).toMatchObject({ state: "error", err: "pull: Network request failed" });
    expect(pb.update).not.toHaveBeenCalled();                      // a push after a pull that never reached it would wait out the same timeouts
    expect(pb.remove).not.toHaveBeenCalled();
  });

  it("the feed's echo of this phone's own push costs no sync; a rev it hasn't seen does", async () => {
    seed(row(A, doc("Shopping", "x\n"), { rec: "ra", rev: 3 }));
    const list = vi.mocked(pb.list);
    heard([{ topic: "notes", action: "update", record: { id: "ra", path: A, rev: 3 } }]);
    expect(list).not.toHaveBeenCalled();
    heard([{ topic: "notes", action: "update", record: { id: "ra", path: A, rev: 4 } }]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("one failed file holds back no other", async () => {
    server({ [A]: ["a\n", 1, "ra"], [B]: ["a\n", 1, "rb"] });
    seed(edited(A, "a\n", "b\n", { rec: "ra" }), edited(B, "a\n", "c\n", { rec: "rb" }));
    const update = vi.mocked(pb.update).getMockImplementation()!;
    vi.mocked(pb.update).mockImplementation(async (s, e, text) => { if (e.path === A) throw new HttpError(500, "HTTP 500"); return update(s, e, text); });
    await syncNotes();
    expect(N(B)).toMatchObject({ rev: 2, base: "c\n" });
    expect(useNotes.getState().notes[A].dirty).toBe(true);
    expect(useNotes.getState().sync).toMatchObject({ state: "error", err: `${A}: HTTP 500` });
  });
});

describe("notes", () => {
  it("creates a note at a fresh path and edits its flags in the frontmatter", () => {
    seed(row("notes/20261005-garage.md", doc("Garage", ""), { deleted: true }));
    const now = new Date(2026, 9, 5, 12).getTime();
    const p = useNotes.getState().create("Garage", { body: "1234\n", now, color: "yellow" });
    expect(p).toBe("notes/20261005-garage-2.md");                                // a tombstone's path is taken
    expect(N(p)!.text).toBe("---\ntitle: Garage\ncreated: 2026-10-05\ncolor: yellow\n---\n1234\n");
    useNotes.getState().setFlags(p, { pinned: true, color: null, tags: ["home"] });
    expect(N(p)!.text).toBe("---\ntitle: Garage\ncreated: 2026-10-05\npinned: true\ntags: [home]\n---\n1234\n");
    expect(useNotes.getState().notes[p]).toMatchObject({ pinned: true, tags: ["home"], dirty: true, snippet: "1234" });
    expect(useNotes.getState().notes[p].color).toBeUndefined();
    expect(useNotes.getState().list[0].path).toBe(p);
  });

  it("a note just made and left as it was goes, with no sync; one touched since, or pushed, stays", () => {
    const { create, discardNew, setFlags } = useNotes.getState();
    const p = create("Empty"), q = create("Pinned after"), s = create("Sent");
    const made = (path: string) => N(path)!.text, mp = made(p), mq = made(q), ms = made(s);
    setFlags(q, { pinned: true });
    fake.patchNote(s, { rec: "rs", rev: 1 });
    discardNew(p, mp); discardNew(q, mq); discardNew(s, ms);
    expect(N(p)).toBeNull();
    expect(useNotes.getState().notes[p]).toBeUndefined();
    expect(N(q)).not.toBeNull();
    expect(N(s)).not.toBeNull();
    expect(pb.list).not.toHaveBeenCalled();
  });

  it("an unchanged write is no edit", () => {
    seed(row(A, "x\n"));
    useNotes.getState().write(A, "x\n");
    expect(N(A)).toMatchObject({ updated: 1, pushed: 1 });
  });
});

describe("the server", () => {
  it("is stored normalised, then synced to; a bad address stores nothing; empty keeps notes on the phone", async () => {
    useKeys.setState({ keys: {} });
    expect(setServer("not a url/at all")).toMatch(/Not a server address/);
    expect(useKeys.getState().keys).toEqual({});
    expect(setServer(" example.ts.net:8097/_/ ")).toBeNull();
    expect(useKeys.getState().keys).toEqual({ server: "https://example.ts.net:8097" });
    await settle();
    expect(pb.list).toHaveBeenCalledWith({ url: "https://example.ts.net:8097" });
    expect(setServer("")).toBeNull();
    expect(useKeys.getState().keys).toEqual({ server: undefined });
    expect(useNotes.getState().sync.state).toBe("off");
  });
});
