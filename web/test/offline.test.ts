import { describe, expect, test } from "bun:test";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { isOffline, next, type Net } from "@/lib/net";
import { persistable, throttled } from "@/lib/persist";

const up: Net = { browser: true, reached: true };

describe("net", () => {
  test("the browser going offline is offline, and back online is a fresh start", () => {
    const off = next(up, "offline");
    expect(isOffline(off)).toBe(true);
    expect(isOffline(next(off, "online"))).toBe(false);
  });
  test("an unreachable server is offline until something gets through", () => {
    const down = next(up, "unreachable");
    expect(isOffline(down)).toBe(true);
    expect(isOffline(next(down, "reached"))).toBe(false);
  });
  test("the browser's online clears a failure noted while it was down", () => {
    expect(isOffline(next(next(next(up, "offline"), "unreachable"), "online"))).toBe(false);
  });
  test("an answer does not bring back a browser that says it is offline", () => {
    expect(isOffline(next(next(up, "offline"), "reached"))).toBe(true);
  });
  test("an event that changes nothing returns the state itself", () => {
    expect(next(up, "reached")).toBe(up);
  });
});

describe("persistable", () => {
  test("the lists and details are kept", () => {
    for (const k of [["tags"], ["lenses"], ["photos", "n1"], ["photos", "all"], ["link-preview", "https://x.test"], ["talk"]]) expect(persistable(k)).toBe(true);
  });
  test("the notes, tasks and links are not: the local copy keeps them", () => {
    for (const k of [["notes"], ["tasks"], ["links"]]) expect(persistable(k)).toBe(false);
  });
  test("the chats, models, articles and anything unknown are not", () => {
    for (const k of [["chats"], ["chat", "c1"], ["agent-models"], ["reader", "https://x.test"], ["find", "q"], ["search", "q"], ["new-thing"], [], [1]]) expect(persistable(k)).toBe(false);
  });
});

describe("throttled persister", () => {
  const client = (n: number): PersistedClient => ({ timestamp: n, buster: "b", clientState: { mutations: [], queries: [] } });
  const kv = () => {
    const stored = new Map<string, PersistedClient>(), writes: number[] = [];
    return { stored, writes, get: async (k: string) => stored.get(k), set: async (k: string, v: PersistedClient) => { writes.push(v.timestamp); stored.set(k, v); }, del: async (k: string) => { stored.delete(k); } };
  };

  test("writes the latest of a burst once", async () => {
    const s = kv(), p = throttled(s, "k", 20);
    p.persistClient(client(1)); p.persistClient(client(2)); p.persistClient(client(3));
    await Bun.sleep(60);
    expect(s.writes).toEqual([3]);
    expect((await p.restoreClient())?.timestamp).toBe(3);
  });
  test("flush writes at once, and nothing is left for the timer", async () => {
    const s = kv(), p = throttled(s, "k", 20);
    p.persistClient(client(1));
    await p.flush();
    expect(s.writes).toEqual([1]);
    await Bun.sleep(60);
    expect(s.writes).toEqual([1]);
  });
  test("remove drops a write still waiting", async () => {
    const s = kv(), p = throttled(s, "k", 20);
    p.persistClient(client(1));
    await p.removeClient();
    await Bun.sleep(60);
    expect(s.writes).toEqual([]);
    expect(await p.restoreClient()).toBeUndefined();
  });
  test("disabled, a cache change and a flush after it are not stored", async () => {
    const s = kv(), p = throttled(s, "k", 20);
    p.persistClient(client(1));
    p.disable();
    await p.removeClient();
    p.persistClient(client(2));
    await p.flush();
    await Bun.sleep(60);
    expect(s.writes).toEqual([]);
    expect(await p.restoreClient()).toBeUndefined();
  });
  test("removing the stored client alone does not stop the writing (the provider drops a stale cache this way)", async () => {
    const s = kv(), p = throttled(s, "k", 20);
    await p.removeClient();
    p.persistClient(client(1));
    await p.flush();
    expect(s.writes).toEqual([1]);
  });
  test("a store that fails costs the copy, not the app", async () => {
    const p = throttled({ get: async () => undefined, set: async () => { throw new Error("full"); }, del: async () => {} }, "k", 5);
    p.persistClient(client(1));
    await expect(p.flush()).resolves.toBeUndefined();
  });
});
