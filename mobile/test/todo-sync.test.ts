// The task sync in store/todo.ts against a fake server and the in-memory db.ts: pulled, created under the phone's own
// ids, merged field by field on a stale rev, deleted, and resurrected by an edit that outlived a delete. The fake keeps
// PocketBase's contract (server/pb_hooks/rev.pb.js): compare-and-swap on rev, rev 1 on create, a taken id refused.
// Links keep theirs (ARCHITECTURE.md "Links"): no rev, add and remove idempotent, a
// relation held once whatever the id, 404 for an end that is gone, a task's delete taking its links.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/core/http";
import * as pb from "@/core/pocketbase";
import { notesOfTask, type Link, type LinkEnd } from "@/core/record-links";
import { newTask, retagTask, type Task } from "@/core/todo";
import { useKeys } from "@/store/keys";
import { heardTodo, reloadTodo, syncTodo, useTodo } from "@/store/todo";
import { fake } from "./helpers";

const srv = vi.hoisted(() => ({ tasks: new Map<string, any>(), links: new Map<string, any>(), calls: [] as string[] }));

vi.mock("@/store/db", async () => (await import("./helpers")).fake);
vi.mock("@/store/storage", async () => (await import("./helpers")).fakeStorage);
vi.mock("expo-secure-store", () => ({ getItem: () => null, setItem: () => {}, deleteItemAsync: async () => {} }));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("@/core/pocketbase", async (orig) => {
  const real = await orig<typeof import("@/core/pocketbase")>(), { taskOf } = await import("@/core/todo");
  const tasks = () => {
    const m = srv.tasks;
    const log = (op: string, id = "") => srv.calls.push(`${op} tasks${id ? ` ${id}` : ""}`);
    return {
      revs: async () => { log("revs"); return [...m.values()].map((r) => ({ id: r.id, rev: r.rev })); },
      list: async () => [...m.values()].map((r) => structuredClone(r)),
      get: async (_s: unknown, id: string) => { log("get", id); return m.has(id) ? structuredClone(m.get(id)) : null; },
      getMany: async (_s: unknown, ids: string[]) => { if (ids.length) log("getMany", ids.join(",")); return ids.filter((i) => m.has(i)).map((i) => structuredClone(m.get(i))); },
      create: async (_s: unknown, r: any) => {
        log("create", r.id);
        if (m.has(r.id)) throw new real.Conflict(r.id);
        const rec = { ...taskOf(r), rev: 1 };
        m.set(r.id, rec);
        return structuredClone(rec);
      },
      update: async (_s: unknown, id: string, rev: number, fields: any) => {
        log("update", id);
        const cur = m.get(id);
        if (!cur) return null;
        if (cur.rev !== rev) throw new real.Conflict(id);
        Object.assign(cur, fields, { rev: cur.rev + 1 });
        return structuredClone(cur);
      },
      remove: async (_s: unknown, id: string, rev: number) => {
        log("remove", id);
        const cur = m.get(id);
        if (!cur) return;
        if (cur.rev !== rev) throw new real.Conflict(id);
        m.delete(id);
        for (const [k, l] of srv.links) if (!srv.tasks.has(l.from.type === "task" ? l.from.id : l.to.id) && [l.from, l.to].some((e: any) => e.type === "task")) srv.links.delete(k);
      },
    };
  };
  const { sameLink } = await import("@/core/record-links"), { HttpError } = await import("@/core/http");
  const links = {
    ids: async () => { srv.calls.push("ids links"); return [...srv.links.keys()]; },
    list: async (_s: unknown, filter = "") => {
      const want = [...filter.matchAll(/id = "([^"]+)"/g)].map((m) => m[1]);
      srv.calls.push(`list links ${want.join(",")}`);
      return [...srv.links.values()].filter((l) => !filter || want.includes(l.id)).map((l) => structuredClone(l));
    },
    add: async (_s: unknown, l: any) => {
      srv.calls.push(`add links ${l.id}`);
      if ([l.from, l.to].some((e: any) => (e.type === "task" && !srv.tasks.has(e.id)) || (e.type === "note" && e.id.startsWith("gone")))) throw new HttpError(404, "end gone");
      const had = [...srv.links.values()].find((x) => x.id === l.id || sameLink(x, l));
      if (had) return structuredClone(had);
      srv.links.set(l.id, structuredClone(l));
      return structuredClone(l);
    },
    remove: async (_s: unknown, id: string) => { srv.calls.push(`remove links ${id}`); srv.links.delete(id); },
  };
  return { ...real, tasks: tasks(), links };
});

const at = (coll: "tasks", id: string) => srv[coll].get(id);
const onServer = (coll: "tasks", r: Task, rev = 1) => srv[coll].set(r.id, { ...structuredClone(r), rev });
const store = () => useTodo.getState();
const task = (id: string, title: string, p: Partial<Task> = {}) => newTask(id, { title, ...p });
/** A row in step with the server at `rev`. */
const synced = (coll: "tasks", r: Task, rev = 1) => {
  fake.putRecord({ coll, id: r.id, data: r, base: r, rev, updated: 1, pushed: 1, deleted: false });
  onServer(coll, r, rev);
};

beforeEach(() => {
  fake.reset();
  srv.tasks.clear(); srv.links.clear(); srv.calls.length = 0;
  useKeys.setState({ keys: { server: "https://n" } });
  reloadTodo();
});

describe("pull", () => {
  it("takes the server's records, then fetches only what moved", async () => {
    onServer("tasks", task("t1", "Call", { when: "2026-11-03" }), 3);
    await syncTodo();
    expect(store().tasks.t1).toMatchObject({ title: "Call", when: "2026-11-03" });
    expect(store().sync.state).toBe("idle");
    srv.calls.length = 0;
    await syncTodo();
    expect(srv.calls).toEqual(["revs tasks", "ids links"]);
  });

  it("drops what the server no longer has, unless edited here", async () => {
    synced("tasks", task("t1", "gone"));
    synced("tasks", task("t2", "edited"));
    reloadTodo();
    store().update("t2", { title: "edited here" });
    srv.tasks.clear();
    await syncTodo();
    expect(Object.keys(store().tasks)).toEqual(["t2"]);
    expect(at("tasks", "t2")).toMatchObject({ title: "edited here", rev: 1 });     // put back
  });
});

describe("push", () => {
  it("creates under the phone's own ids", async () => {
    const t = store().add({ title: "Call", when: "2026-11-03" });
    await syncTodo();
    expect(at("tasks", t)).toMatchObject({ title: "Call", when: "2026-11-03", rev: 1 });
    expect(fake.getRecord("tasks", t)).toMatchObject({ rev: 1, base: expect.objectContaining({ title: "Call" }) });
    expect(fake.dirtyRecords("tasks")).toEqual([]);
  });

  it("a stale rev: each side's fields kept, the merge sent", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    store().update("t1", { title: "Call plumber" });
    Object.assign(at("tasks", "t1"), { when: "2026-11-04", rev: 2 });
    await syncTodo();
    expect(at("tasks", "t1")).toMatchObject({ title: "Call plumber", when: "2026-11-04", rev: 3 });
    expect(store().tasks.t1).toMatchObject({ title: "Call plumber", when: "2026-11-04" });
    expect(fake.dirtyRecords("tasks")).toEqual([]);
  });

  it("a field both changed: the phone's edit wins", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    store().update("t1", { title: "Mine" });
    Object.assign(at("tasks", "t1"), { title: "Theirs", notes: "laptop", rev: 2 });
    await syncTodo();
    expect(at("tasks", "t1")).toMatchObject({ title: "Mine", notes: "laptop", rev: 3 });
  });

  it("a create that landed before the app died: merged onto, not duplicated", async () => {
    const t = task("t1", "Call");
    fake.putRecord({ coll: "tasks", id: "t1", data: { ...t, notes: "more" }, base: null, rev: null, updated: 2, pushed: null, deleted: false });
    onServer("tasks", t);
    reloadTodo();
    await syncTodo();
    expect(srv.tasks.size).toBe(1);
    expect(at("tasks", "t1")).toMatchObject({ notes: "more", rev: 2 });
  });

  it("a repeating task ticked: the done one and the next round both go up", async () => {
    synced("tasks", task("t1", "Gym", { when: "2026-10-27", every: "1w" }));
    reloadTodo();
    const next = store().complete("t1")!;
    await syncTodo();
    expect(at("tasks", "t1")).toMatchObject({ every: "", rev: 2 });
    expect(at("tasks", "t1").done).not.toBe("");
    expect(at("tasks", next)).toMatchObject({ title: "Gym", every: "1w", done: "", rev: 1 });
  });
});

describe("tags", () => {
  it("a tag put on here and one added on the server both stay: tags merge as a set", async () => {
    synced("tasks", task("t1", "Call", { tags: ["home"] }));
    reloadTodo();
    store().update("t1", { tags: retagTask(store().tasks.t1, ["urgent"]).tags });
    Object.assign(at("tasks", "t1"), { tags: ["home", "Phone"], rev: 2 });
    await syncTodo();
    expect(at("tasks", "t1")).toMatchObject({ tags: ["home", "urgent", "Phone"], rev: 3 });
    expect(store().tasks.t1.tags).toEqual(["home", "urgent", "Phone"]);
  });

  it("a tag taken off here stays off, whatever else the server added", async () => {
    synced("tasks", task("t1", "Call", { tags: ["home", "phone"] }));
    reloadTodo();
    store().update("t1", { tags: retagTask(store().tasks.t1, [], ["PHONE"]).tags });
    Object.assign(at("tasks", "t1"), { tags: ["home", "phone", "work"], rev: 2 });
    await syncTodo();
    expect(at("tasks", "t1").tags).toEqual(["home", "work"]);
  });

  it("the auto-tagger's tags arrive with its rev, and survive an edit made here meanwhile", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    Object.assign(at("tasks", "t1"), { tags: ["home"], rev: 2 });
    await syncTodo();
    expect(store().tasks.t1.tags).toEqual(["home"]);
    store().update("t1", { title: "Call plumber" });
    Object.assign(at("tasks", "t1"), { tags: ["home", "work"], rev: 3 });
    await syncTodo();
    expect(store().tasks.t1).toMatchObject({ title: "Call plumber", tags: ["home", "work"] });
    expect(at("tasks", "t1")).toMatchObject({ title: "Call plumber", tags: ["home", "work"] });
  });

  it("a task cached before tags existed reads as untagged and goes up with them", async () => {
    const { tags: _t, ...old } = task("t1", "Old");
    fake.putRecord({ coll: "tasks", id: "t1", data: old as Task, base: old as Task, rev: 1, updated: 1, pushed: 1, deleted: false });
    onServer("tasks", task("t1", "Old"));
    reloadTodo();
    expect(store().tasks.t1).toMatchObject({ tags: [] });
    store().update("t1", { tags: ["home"] });
    await syncTodo();
    expect(at("tasks", "t1")).toMatchObject({ tags: ["home"], rev: 2 });
  });
});

describe("delete", () => {
  it("a tombstone goes up; one never pushed just goes", async () => {
    synced("tasks", task("t1", "old"));
    reloadTodo();
    const t2 = store().add({ title: "never sent" });
    store().remove("t1");
    store().remove(t2);
    expect(fake.getRecord("tasks", t2)).toBeNull();
    await syncTodo();
    expect(srv.tasks.size).toBe(0);
    expect(fake.recordTombstones("tasks")).toEqual([]);
  });

  it("an edit on the server outlives the delete", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    store().remove("t1");
    Object.assign(at("tasks", "t1"), { title: "Call today", rev: 2 });
    await syncTodo();
    expect(store().tasks.t1).toMatchObject({ title: "Call today" });
    expect(fake.getRecord("tasks", "t1")).toMatchObject({ rev: 2, deleted: false });
  });
});

describe("realtime", () => {
  it("syncs on news, not on its own push echoing back", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    srv.calls.length = 0;
    heardTodo([{ topic: "tasks", action: "update", record: { id: "t1", rev: 1 } }]);
    heardTodo([{ topic: "notes", action: "update", record: { id: "x", rev: 9 } }]);
    await Promise.resolve();
    expect(srv.calls).toEqual([]);
    heardTodo([{ topic: "tasks", action: "update", record: { id: "t1", rev: 2 } }]);
    await syncTodo();
    expect(srv.calls[0]).toBe("revs tasks");
  });
});

describe("links", () => {
  const T = (id: string) => ({ type: "task", id }) as const, N = (id: string) => ({ type: "note", id }) as const;
  const link = (id: string, from: LinkEnd, to: LinkEnd, role: "about" | "source" = "about"): Link => ({ id, from, to, role });
  /** A link the phone and the server both have. */
  const both = (l: Link) => { fake.putLink({ link: l, pushed: 1, deleted: false }); srv.links.set(l.id, structuredClone(l)); };

  it("pulls the server's set: fetches only the ids it lacks, drops what the server dropped, keeps what it hasn't sent", async () => {
    synced("tasks", task("t1", "Call"));
    both(link("l1", T("t1"), N("n1")));
    fake.putLink({ link: link("l2", T("t1"), N("n2")), pushed: 1, deleted: false });          // gone from the server
    fake.putLink({ link: link("l3", T("t1"), N("n3")), pushed: null, deleted: false });       // made here
    srv.links.set("l4", link("l4", T("t1"), N("n4")));
    reloadTodo();
    await syncTodo();
    expect(srv.calls).toContain("list links l4");
    expect(notesOfTask(store().links, "t1").sort()).toEqual(["n1", "n3", "n4"]);
    expect([...srv.links.keys()].sort()).toEqual(["l1", "l3", "l4"]);
    expect(fake.linkRows().every((r) => r.pushed != null)).toBe(true);
    srv.calls.length = 0;
    await syncTodo();
    expect(srv.calls.filter((c) => c.includes("links"))).toEqual(["ids links"]);
  });

  it("a link to a new task goes up after the task, under the phone's id", async () => {
    const t = store().add({ title: "Pay" });
    const id = store().addLink(T(t), N("n1"), "about");
    expect(store().addLink(T(t), N("n1"), "about")).toBe(id);                                 // the phone has it already
    expect(notesOfTask(store().links, t)).toEqual(["n1"]);
    await syncTodo();
    expect(srv.calls.indexOf(`create tasks ${t}`)).toBeLessThan(srv.calls.indexOf(`add links ${id}`));
    expect(srv.links.get(id)).toEqual(link(id, T(t), N("n1")));
    expect(fake.getLink(id)?.pushed).not.toBeNull();
    expect(at("tasks", t).rev).toBe(1);                                                        // a link never moves the task's rev
  });

  it("takes the server's id when it had the relation already", async () => {
    synced("tasks", task("t1", "Call"));
    srv.links.set("srv1", link("srv1", T("t1"), N("n1")));
    fake.putLink({ link: link("mine", T("t1"), N("n1")), pushed: null, deleted: false });
    reloadTodo();
    await syncTodo();
    expect(fake.linkRows().map((r) => r.link.id)).toEqual(["srv1"]);
    expect(store().links.map((l) => l.id)).toEqual(["srv1"]);
  });

  it("a removal goes up; one never sent just goes", async () => {
    synced("tasks", task("t1", "Call"));
    both(link("l1", T("t1"), N("n1")));
    reloadTodo();
    const l2 = store().addLink(T("t1"), N("n2"), "about");
    store().removeLink("l1");
    store().removeLink(l2);
    expect(store().links).toEqual([]);
    expect(fake.getLink(l2)).toBeNull();
    await syncTodo();
    expect(srv.links.size).toBe(0);
    expect(fake.linkRows()).toEqual([]);
  });

  it("an end gone from the server drops the link here", async () => {
    synced("tasks", task("t1", "Call"));
    fake.putLink({ link: link("l1", T("t1"), N("n1")), pushed: null, deleted: false });
    srv.tasks.clear();
    fake.putRecord({ ...fake.getRecord("tasks", "t1")!, updated: 2 });                        // edited here: it goes back up
    reloadTodo();
    srv.calls.length = 0;
    await syncTodo();
    expect(srv.links.has("l1")).toBe(true);                                                   // the task went back up first
    fake.putLink({ link: link("l2", T("gone"), N("n1")), pushed: null, deleted: false });
    fake.putRecord({ coll: "tasks", id: "gone", data: task("gone", "x"), base: null, rev: 3, updated: 1, pushed: 1, deleted: false });
    await syncTodo();                                                                         // pulled away (not on the server), then its link
    expect(fake.getLink("l2")).toBeNull();
  });

  it("a link the server says has an end gone (404) is dropped, not retried", async () => {
    synced("tasks", task("t1", "Call"));
    fake.putLink({ link: link("l1", T("t1"), N("gone-note")), pushed: null, deleted: false });
    reloadTodo();
    await syncTodo();
    expect(srv.calls).toContain("add links l1");
    expect(fake.getLink("l1")).toBeNull();
    expect(store().sync.state).toBe("idle");
  });

  it("a task deleted here hides its links and drops the unsent ones; the server's cascade takes the rest", async () => {
    synced("tasks", task("t1", "Call"));
    both(link("l1", T("t1"), N("n1")));
    reloadTodo();
    store().addLink(T("t1"), N("n2"), "about");
    store().remove("t1");
    expect(store().links).toEqual([]);
    await syncTodo();
    expect(srv.tasks.size).toBe(0);
    expect(srv.links.size).toBe(0);
    await syncTodo();
    expect(fake.linkRows()).toEqual([]);
  });

  it("a repeating task's next round carries its links, under new ids", async () => {
    synced("tasks", task("t1", "Gym", { when: "2026-10-27", every: "1w" }));
    both(link("l1", T("t1"), N("n1")));
    reloadTodo();
    const next = store().complete("t1")!;
    expect(notesOfTask(store().links, next)).toEqual(["n1"]);
    await syncTodo();
    const carried = [...srv.links.values()].filter((l) => l.from.id === next);
    expect(carried).toHaveLength(1);
    expect(carried[0].id).not.toBe("l1");
    expect(srv.links.has("l1")).toBe(true);
  });

  it("pushes no link while the server can't list them (a server without links answers 404): none is dropped", async () => {
    synced("tasks", task("t1", "Call"));
    reloadTodo();
    const id = store().addLink(T("t1"), N("n1"), "about");
    const ids = vi.spyOn(pb.links, "ids").mockRejectedValueOnce(new HttpError(404, "no collection"));
    await syncTodo();
    expect(srv.calls.some((c) => c.startsWith("add links"))).toBe(false);
    expect(fake.getLink(id)).toMatchObject({ pushed: null, deleted: false });
    expect(store().sync.state).toBe("error");
    ids.mockRestore();
    await syncTodo();
    expect(srv.links.has(id)).toBe(true);
  });

  it("syncs on a link the phone hasn't heard of, not on its own echo", async () => {
    both(link("l1", T("t1"), N("n1")));
    srv.calls.length = 0;
    heardTodo([{ topic: "links", action: "create", record: { id: "l1" } }]);
    heardTodo([{ topic: "links", action: "delete", record: { id: "nope" } }]);
    await Promise.resolve();
    expect(srv.calls).toEqual([]);
    heardTodo([{ topic: "links", action: "create", record: { id: "l9" } }]);
    await syncTodo();
    expect(srv.calls[0]).toBe("revs tasks");
  });
});
