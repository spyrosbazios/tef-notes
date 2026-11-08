// Which tasks ring now, and one scan over fake ports: sent once, to every subscription, not before the time, not long after it.
import { describe, expect, it } from "bun:test";
import { newTask, type Task } from "@/core/todo";
import { dueKey, dueReminders, payloadFor, scan, type Candidate, type Ports } from "../src/reminders";
import type { Outcome, Sub, Vapid } from "../src/push";

const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m).getTime();
let n = 0;
const task = (p: Partial<Task> = {}): Task => newTask(`t${String(++n).padStart(14, "0")}`, { title: "Call", when: "2026-11-08", remind: "09:00", ...p });
const cand = (t: Task, updated = at(8)): Candidate => ({ task: t, updated });
const ids = (d: { task: Task }[]) => d.map((x) => x.task.id);

describe("dueReminders", () => {
  it("rings an open task once its time has come, not before", () => {
    const t = task();
    expect(dueReminders([cand(t)], new Set(), at(8, 59))).toEqual([]);
    expect(ids(dueReminders([cand(t)], new Set(), at(9, 0)))).toEqual([t.id]);
    expect(ids(dueReminders([cand(t)], new Set(), at(9, 30)))).toEqual([t.id]);
  });
  it("lets a reminder go quiet after the late window", () => {
    expect(dueReminders([cand(task())], new Set(), at(10, 0))).toEqual([]);
  });
  it("skips done tasks, tasks without a time or a day, and what was sent", () => {
    const sent = task(), skipped = [task({ done: "2026-11-08" }), task({ remind: "" }), task({ when: "" }), sent];
    expect(dueReminders(skipped.map((t) => cand(t)), new Set([dueKey(sent)]), at(9, 1))).toEqual([]);
  });
  it("skips a reminder set after its time, as the phone does", () => {
    expect(dueReminders([cand(task(), at(9, 0))], new Set(), at(9, 1))).toEqual([]);
    expect(dueReminders([cand(task(), at(9, 0) + 5000)], new Set(), at(9, 1))).toEqual([]);
  });
  it("a task moved to another time is a new reminder", () => {
    const t = task(), moved = { ...t, remind: "09:30" };
    expect(ids(dueReminders([cand(moved)], new Set([dueKey(t)]), at(9, 31)))).toEqual([t.id]);
  });
  it("lists the soonest first", () => {
    const a = task({ remind: "09:30" }), b = task({ remind: "09:00" });
    expect(ids(dueReminders([cand(a), cand(b)], new Set(), at(9, 40)))).toEqual([b.id, a.id]);
  });
});

describe("payloadFor", () => {
  it("is the title, the time, and the task's place in the app", () => {
    const t = task({ title: "  Pay the rent " });
    expect(payloadFor(t)).toEqual({ title: "Pay the rent", body: "09:00", task: t.id, url: `/today?t=${t.id}`, tag: `task:${t.id}` });
    expect(payloadFor({ ...task(), title: "" }).title).toBe("Task");
  });
});

const v: Vapid = { subject: "mailto:a@example.com", publicKey: "p", privateKey: "k" };
const sub = (rec: string): Sub => ({ rec, endpoint: `https://push.example.com/${rec}`, keys: { p256dh: "x", auth: "y" }, label: "", failed: 0 });

function ports(o: { tasks: Candidate[]; subs?: Sub[]; vapid?: Vapid | undefined; sent?: string[]; outcome?: (s: Sub) => Outcome }) {
  const claimed = new Set(o.sent ?? []), delivered: { rec: string; task: string }[] = [];
  const p: Ports = {
    vapid: async () => ("vapid" in o ? o.vapid : v),
    subscriptions: async () => o.subs ?? [sub("s1"), sub("s2")],
    candidates: async () => o.tasks,
    sent: async () => new Set(claimed),
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    release: async (k) => { claimed.delete(k); },
    deliver: async (_v, s, payload): Promise<Outcome> => { delivered.push({ rec: s.rec, task: payload.task }); return o.outcome?.(s) ?? "sent"; },
  };
  return { p, delivered, claimed };
}

describe("scan", () => {
  it("sends a due reminder to every subscription, and only once", async () => {
    const t = task(), { p, delivered } = ports({ tasks: [cand(t)] });
    expect(await scan(p, at(9, 1))).toEqual([dueKey(t)]);
    expect(delivered).toEqual([{ rec: "s1", task: t.id }, { rec: "s2", task: t.id }]);
    expect(await scan(p, at(9, 2))).toEqual([]);
    expect(delivered).toHaveLength(2);
  });
  it("does nothing while push is off or nobody is subscribed", async () => {
    const t = task();
    const off = ports({ tasks: [cand(t)], vapid: undefined }), none = ports({ tasks: [cand(t)], subs: [] });
    expect(await scan(off.p, at(9, 1))).toEqual([]);
    expect(await scan(none.p, at(9, 1))).toEqual([]);
    expect(off.delivered.length + none.delivered.length + off.claimed.size + none.claimed.size).toBe(0);
  });
  it("skips a reminder another scan claimed first", async () => {
    const t = task(), { p, delivered } = ports({ tasks: [cand(t)] });
    p.sent = async () => new Set();           // the listing was read before the other scan's claim landed
    p.claim = async () => false;
    expect(await scan(p, at(9, 1))).toEqual([]);
    expect(delivered).toEqual([]);
  });
  it("gives the claim back when every delivery failed, so the next scan tries again", async () => {
    const t = task(), r = ports({ tasks: [cand(t)], outcome: () => "failed" });
    expect(await scan(r.p, at(9, 1))).toEqual([]);
    expect(r.claimed.size).toBe(0);
    r.p.deliver = async (_v, s, payload) => { r.delivered.push({ rec: s.rec, task: payload.task }); return "sent"; };
    expect(await scan(r.p, at(9, 2))).toEqual([dueKey(t)]);
    expect(r.delivered).toHaveLength(4);
    expect(r.claimed.has(dueKey(t))).toBe(true);
  });
  it("gives it back when every subscription was dropped too", async () => {
    const t = task(), r = ports({ tasks: [cand(t)], outcome: (s) => (s.rec === "s1" ? "failed" : "dropped") });
    expect(await scan(r.p, at(9, 1))).toEqual([]);
    expect(r.claimed.size).toBe(0);
  });
  it("keeps the claim when any delivery was sent or its subscription gone", async () => {
    for (const outcome of [(s: Sub) => (s.rec === "s1" ? "sent" : "failed"), (s: Sub) => (s.rec === "s1" ? "gone" : "failed")] as ((s: Sub) => Outcome)[]) {
      const t = task(), r = ports({ tasks: [cand(t)], outcome });
      expect(await scan(r.p, at(9, 1))).toEqual([dueKey(t)]);
      expect(r.claimed.has(dueKey(t))).toBe(true);
    }
  });
});
