import { expect, test } from "bun:test";
import { readChatHistory, serializeChatHistory } from "../src/chat-history";

const messages = [{ id: "a", role: "assistant" as const, metadata: { old: true }, parts: [
  { type: "tool-retired", toolCallId: "c", state: "output-available", input: { old: 1 }, output: { card: { title: "Keep" } } },
] }];
test("legacy and current history preserve opaque parts and metadata through a roundtrip", () => {
  for (const historyVersion of [undefined, null, 0, 1]) {
    const read = readChatHistory({ historyVersion, messages });
    expect(read).toEqual(messages);
    expect(readChatHistory(JSON.parse(JSON.stringify(serializeChatHistory(read))))).toEqual(messages);
    expect(serializeChatHistory(read).historyVersion).toBe(1);
  }
});
test("only legacy records permit absent or null messages", () => {
  expect(readChatHistory({})).toEqual([]);
  expect(readChatHistory({ historyVersion: 0, messages: null })).toEqual([]);
  expect(() => readChatHistory({ historyVersion: 1, messages: null })).toThrow("Malformed");
});
test("malformed and unsupported records fail explicitly without discarding history", () => {
  for (const record of [null, [], { messages: {} }, { messages: [{ id: "x", role: "assistant", parts: [{ type: "tool-x", toolCallId: "c", state: "approval-responded" }] }] }, { messages: [null] }, { messages: [{ id: "x", role: "user", parts: null }] },
    { messages: [{ id: "x", role: "user", parts: [{ type: "text", text: 3 }] }] }])
    expect(() => readChatHistory(record)).toThrow("Malformed");
  for (const historyVersion of [2, 999, "1", -1]) {
    const record = { historyVersion, messages };
    expect(() => readChatHistory(record)).toThrow("Unsupported chat history version");
    expect(record.messages).toEqual(messages);
  }
});
