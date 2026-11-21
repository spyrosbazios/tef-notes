import { afterEach, expect, test } from "bun:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { Conflict, Refused, Unavailable } from "@/core/pocketbase";
import { linkRecord, type Link } from "@/core/record-links";
import { newTask } from "@/core/todo";
import { api, Offline } from "@/services/api";
import * as notes from "@/services/notes";
import { tasks } from "@/services/todo";
import * as links from "@/services/links";
import { getNet, note } from "@/lib/net";

const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; note("online"); });
function stub(reply: (c: InternalAxiosRequestConfig) => { status?: number; data?: unknown }) {
  const calls: InternalAxiosRequestConfig[] = [];
  api.defaults.adapter = async (config) => {
    calls.push(config);
    const { status = 200, data = {} } = reply(config);
    const response = { status, data, statusText: "", headers: {}, config };
    if (status >= 400) throw new AxiosError("refused", undefined, config, undefined, response);
    return response;
  };
  return calls;
}

test("web note projection and read timeout survive the adapter, synced writes bypass offline refusal", async () => {
  const row = { id: "n", path: "notes/a.md", rev: 3, updated: "today", kind: "note" };
  const calls = stub((c) => ({ data: c.method === "get" ? { items: [row] } : row }));
  expect(await notes.read("notes/a.md", 123)).toEqual({ rec: "n", path: "notes/a.md", rev: 3, updated: "today", kind: "note", text: "" });
  expect(calls[0].timeout).toBe(123);
  expect(calls[0].url).toContain("fields=id,path,rev,kind,text,updated");
  await notes.read("notes/a.md");
  expect(calls[1].timeout).toBe(45_000);
  note("offline");
  await notes.update({ rec: "n", path: "notes/a.md", rev: 2 }, "body");
  expect(calls[2].synced).toBe(true);
  expect(JSON.parse(calls[2].data)).toMatchObject({ rev: 2, text: "body" });
  await tasks.create(newTask("t", { title: "Test" }));
  expect(calls[3].synced).toBe(true);
  await expect(api.post("collections/lenses/records", {})).rejects.toBeInstanceOf(Offline);
  expect(calls).toHaveLength(4);
});

test("axios conflicts retain messages; 404 becomes null; other answers are typed outcomes", async () => {
  let status = 409;
  stub(() => ({ status, data: { message: "Changed since that version." } }));
  await expect(tasks.update("t", 4, { title: "x" })).rejects.toBeInstanceOf(Conflict);
  await expect(notes.get("n")).rejects.toThrow("Changed since that version.");
  status = 404;
  expect(await notes.get("n")).toBeNull();
  expect(await tasks.get("t")).toBeNull();
  await links.remove("gone");
  status = 403;
  await expect(tasks.get("t")).rejects.toBeInstanceOf(Refused);
  status = 503;
  await expect(tasks.get("t")).rejects.toBeInstanceOf(Unavailable);
  expect(getNet().reached).toBe(true);
});

test("web links recover duplicate ends with the server id through axios", async () => {
  const l: Link = { id: "local", from: { type: "task", id: "t" }, to: { type: "note", id: "n" }, role: "about" };
  const calls = stub((c) => c.method === "post"
    ? { status: 400, data: {} }
    : { data: { items: [linkRecord({ ...l, id: "server" })] } });
  expect(await links.add(l)).toEqual({ ...l, id: "server" });
  expect(calls.every((c) => c.synced)).toBe(true);
  expect(await links.byIds([])).toEqual([]);
  expect(calls).toHaveLength(2);
});

test("network errors still update connectivity and are Unavailable", async () => {
  api.defaults.adapter = async (c) => { throw new AxiosError("network", AxiosError.ERR_NETWORK, c); };
  await expect(notes.read("notes/a.md")).rejects.toBeInstanceOf(Unavailable);
  expect(getNet().reached).toBe(false);
});
