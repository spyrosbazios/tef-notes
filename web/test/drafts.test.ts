// The one save-as-you-type primitive (src/lib/drafts.ts), over a kept text in memory and a hand-run timer.
import { expect, test } from "bun:test";
import type { Mark } from "@/core/record-contracts";
import { createDraft, LINES, MINE, shown, type Merge } from "@/lib/drafts";

function fixture(merge: Merge, kept = "", trims = false) {
  const field = { kept: kept as string | undefined, writes: [] as [string, Mark][], fail: null as string | null };
  const timers: (() => void)[] = [];
  const d = createDraft({
    field: {
      read: () => field.kept,
      write: async (text, mark) => { if (field.fail) throw new Error(field.fail); field.writes.push([text, mark]); field.kept = trims ? text.trim() : text; },
    },
    merge, delay: 700, schedule: (work) => { timers.push(work); return () => { timers.splice(timers.indexOf(work), 1); }; },
  });
  return { d, field, timers };
}

test("typing goes out once, after the pause, and the box then shows what is kept", async () => {
  const { d, field, timers } = fixture(MINE, "a");
  d.type("ab"); d.type("abc");
  expect(timers).toHaveLength(1);
  expect(d.get()).toMatchObject({ text: "abc", status: "unsaved" });
  timers[0]!();
  await d.flush();
  expect(field.writes).toEqual([["abc", {}]]);
  expect(d.get()).toMatchObject({ text: null, status: "saved" });
});

test("a save that fails keeps what was typed and sends it with the next flush", async () => {
  const { d, field } = fixture(MINE, "Call plumber");
  d.type("Call the plumber");
  field.fail = "This was deleted on another device.";
  await d.flush();
  expect(d.get()).toMatchObject({ text: "Call the plumber", status: "error", error: "This was deleted on another device." });
  expect(shown(d.get(), field.kept!)).toBe("Call the plumber");      // the box keeps the typed text, not the kept one
  expect(d.pending()).toBe(true);
  field.fail = null;
  await d.flush();
  expect(field.writes).toEqual([["Call the plumber", {}]]);
  expect(d.get()).toMatchObject({ text: null, status: "saved", error: null });
});

test("a store that trims doesn't eat the space typed before a pause", async () => {
  const { d, field } = fixture(MINE, "a", true);                      // a store that trims
  d.type("a b ");
  await d.flush();
  expect(field.kept).toBe("a b");
  expect(shown(d.get(), field.kept!)).toBe("a b ");
  field.kept = "from elsewhere";
  expect(shown(d.get(), field.kept)).toBe("from elsewhere");          // another change is taken in at rest
});

test("lines merge with what moved on meanwhile; the same lines clash, and the owner picks", async () => {
  const { d, field } = fixture(LINES, "one\ntwo\nthree");
  d.type("one mine\ntwo\nthree");
  field.kept = "one\ntwo\nthree theirs";
  await d.flush();
  expect(field.writes.at(-1)).toEqual(["one mine\ntwo\nthree theirs", {}]);
  expect(d.get().merged).toBe(1);
  d.type("one again\ntwo\nthree theirs");
  field.kept = "one other\ntwo\nthree theirs";
  await d.flush();
  expect(d.get().clash).toEqual({ mine: "one again\ntwo\nthree theirs", theirs: "one other\ntwo\nthree theirs" });
  expect(d.pending()).toBe(true);
  await d.resolve("mine");
  expect(field.kept).toBe("one again\ntwo\nthree theirs");
  d.type("x");
  field.kept = "y";
  await d.flush();
  await d.resolve("theirs");
  expect([d.get().text, d.pending(), field.kept]).toEqual([null, false, "y"]);
});

test("someone else's words put in are saved with the tainted mark, the pending text or the next typed", async () => {
  const { d, field } = fixture(MINE, "");
  d.type("mine and a summary");
  d.taint();
  await d.flush();
  expect(field.writes).toEqual([["mine and a summary", { tainted: true }]]);
  const later = fixture(MINE, "");
  later.d.taint();                                                    // the insert's change not typed in yet
  later.d.type("a summary");
  await later.d.flush();
  expect(later.field.writes).toEqual([["a summary", { tainted: true }]]);
  later.d.type("a summary, typed on");
  await later.d.flush();
  expect(later.field.writes.at(-1)).toEqual(["a summary, typed on", {}]);
});

test("typing on while a save is out goes on from what was sent", async () => {
  const { d, field } = fixture(LINES, "a\nb");
  d.type("a1\nb");
  const out = d.flush();
  await Promise.resolve();                                            // the save is out: written, its answer not yet back
  expect(field.writes).toHaveLength(1);
  d.type("a1\nb2");
  await out;
  expect(d.get()).toMatchObject({ text: "a1\nb2", status: "unsaved" });
  await d.flush();
  expect(field.writes.map(([t]) => t)).toEqual(["a1\nb", "a1\nb2"]);
});
