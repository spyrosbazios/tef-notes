// Queued chat messages are each chat's own: moving the dock to another chat and back keeps them, files and all.
import { expect, test } from "bun:test";
import type { FileUIPart } from "ai";
import { added, pausedAs, queueOf, requeued, without, type Queues } from "@/lib/chat-queue";

const photo: FileUIPart = { type: "file", mediaType: "image/png", filename: "a.png", url: "data:image/png;base64,AA==" };

test("a chat's queue stays its own when another chat is open", () => {
  let all: Queues = {};
  all = requeued(all, "a", added({ id: 0, text: "then this", files: [photo] }));
  all = requeued(all, "b", added({ id: 1, text: "other chat", files: [] }));
  expect(queueOf(all, "a").items).toEqual([{ id: 0, text: "then this", files: [photo] }]);
  expect(queueOf(all, "b").items.map((q) => q.text)).toEqual(["other chat"]);
  expect(queueOf(all, "c")).toEqual({ items: [], paused: false });
});

test("in order; one taken off leaves the rest, and a pause is per chat", () => {
  let all: Queues = {};
  for (const [id, text] of [[0, "one"], [1, "two"], [2, "three"]] as const) all = requeued(all, "a", added({ id, text, files: [] }));
  all = requeued(all, "a", pausedAs(true));
  all = requeued(all, "a", without(1));
  expect(queueOf(all, "a")).toEqual({ items: [{ id: 0, text: "one", files: [] }, { id: 2, text: "three", files: [] }], paused: true });
  expect(queueOf(all, "b").paused).toBe(false);
});

test("an emptied queue goes, its pause with it", () => {
  let all: Queues = requeued({}, "a", added({ id: 0, text: "x", files: [] }));
  all = requeued(all, "a", pausedAs(true));
  all = requeued(all, "a", without(0));
  expect(all).toEqual({});
});
