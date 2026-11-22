import { afterEach, beforeEach, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { AxiosError } from "axios";
import { api, Offline } from "@/services/api";
import { chat, createChat } from "@/services/agent";
import { note } from "@/lib/net";

const original = api.defaults.adapter;
beforeEach(() => note("online"));
afterEach(() => { api.defaults.adapter = original; note("online"); });
const messages: UIMessage[] = [{ id: "a", role: "assistant", parts: [{ type: "tool-old", toolCallId: "c", state: "output-available", input: { old: 1 }, output: { title: "Keep" } }] }];
test("web reads legacy/current history intact and creates the current format", async () => {
  let data: unknown = { id: "c", messages };
  const sent: unknown[] = [];
  api.defaults.adapter = async (config) => {
    if (config.method === "get") expect(config.url).toContain("historyVersion");
    else sent.push(JSON.parse(config.data));
    return { data, status: 200, statusText: "", headers: {}, config };
  };
  expect((await chat("c"))?.messages).toEqual(messages);
  data = { id: "c", historyVersion: 1, messages };
  expect((await chat("c"))?.messages).toEqual(messages);
  await createChat("new", "Title");
  expect(sent).toEqual([{ id: "new", title: "Title", historyVersion: 1, messages: [] }]);
  data = { id: "c", messages: null };
  expect((await chat("c"))?.messages).toEqual([]);
  data = { id: "c", historyVersion: 2, messages };
  await expect(chat("c")).rejects.toThrow("Unsupported chat history version");
  data = { id: "c", messages: {} };
  await expect(chat("c")).rejects.toThrow("Malformed");
});
test("a missing chat remains null", async () => {
  api.defaults.adapter = async (config) => { throw new AxiosError("gone", undefined, config, undefined,
    { data: {}, status: 404, statusText: "", headers: {}, config }); };
  expect(await chat("gone")).toBeNull();
});

test("chat creation still refuses offline writes", async () => {
  note("offline");
  await expect(createChat("new", "Title")).rejects.toBeInstanceOf(Offline);
});
