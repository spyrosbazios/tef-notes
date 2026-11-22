// Task reminders as Web Push: every minute, the open tasks whose `when` day and `remind` time have come get one push to
// each subscribed browser (push.ts). The rules are the phone's (core/things.ts `remindAt`, `reminderPlan`; the phone rings
// the same tasks as local notifications), read in the server's TZ: an open task with both a day and a time. Two differences,
// both of a server that is not scheduling ahead: a reminder rings within `LATE` of its time and not later (a restart or an
// outage does not replay yesterday), and not when it was set after its time, which the phone skips as "no longer ahead".
// "Set after its time" is judged by what defines the reminder (the task, its day and its time: `dueKey`), never by the task's
// `updated` alone, which a tag rename or the auto-tagger moves too: a scan that saw the reminder before its time has armed it,
// and it rings whatever touched the task since; only one no scan saw ahead of time falls back to `updated` against its time.
// What was sent is a `push_sent` record (pb_migrations/1794300000_push_subscriptions.js), claimed before sending so a
// slow push or a second scan never sends it twice; a task moved to another time is a new key and rings again. A claim whose
// every delivery failed is given back, so the next scan (within `LATE`) tries again; one that anything reached, or that
// found its subscriptions gone, is kept.
//
// `remind` is a wall-clock time with no zone: the agent reads it in its own TZ (docker-compose sets it from `TZ`), which must
// be the owner's, or every reminder rings hours off.
import { HttpError } from "@/core/client/http";
import { taskUrl, type PushPayload } from "@/core/push";
import * as pb from "@/core/client/pocketbase";
import { lit, Conflict } from "@/core/record-contracts";
import { createdUnder } from "@/core/record-protocol";
import { remindAt } from "@/core/things";
import { taskOf, type Task } from "@/core/todo";
import { addDays } from "@/core/dates";
import { localDay } from "@/core/days";
import type { Server } from "@/core/server-urls";
import { time } from "./application/metadata";
import { deliver, subscriptions, vapid, type Outcome, type Sub, type Vapid } from "./push";

/** How long after its time a reminder still rings. */
export const LATE = 60 * 60_000;
const SENT_KEPT = 2 * 86_400_000;
const EVERY = 60_000;

/** An open task with a reminder, and when it was last saved. */
export type Candidate = { task: Task; updated: number };
export type Due = { key: string; task: Task };

/** What was sent for a task at this day and time: a change of either is a new reminder. */
export const dueKey = (t: Pick<Task, "id" | "when" | "remind">) => `${t.id}@${t.when}T${t.remind}`;

/** The reminders to send now, soonest first: open, their time reached and not `late` past, set before it came, not in `sent`.
 *  Set before it came: `armed` holds it (an earlier scan saw it ahead of its time, so it was set before it, and a later touch
 *  of the task changes nothing), or else the task was last saved before its time. */
export function dueReminders(candidates: Candidate[], sent: ReadonlySet<string>, now: number, { late = LATE, armed = new Set<string>() } = {}): Due[] {
  const out: (Due & { at: number })[] = [];
  for (const { task, updated } of candidates) {
    const at = task.done ? null : remindAt(task);
    if (at === null || at > now || at <= now - late || (updated >= at && !armed.has(dueKey(task))) || sent.has(dueKey(task))) continue;
    out.push({ key: dueKey(task), task, at });
  }
  return out.sort((a, b) => a.at - b.at).map(({ key, task }) => ({ key, task }));
}

/** What a reminder shows: the task's title, and the time it was set for. */
export const payloadFor = (t: Task): PushPayload => ({
  title: t.title.trim().slice(0, 120) || "Task", body: t.remind, task: t.id, url: taskUrl(t.id), tag: `task:${t.id}`,
});

/** Where a scan reads and writes: PocketBase's, or a test's. */
export type Ports = {
  vapid(): Promise<Vapid | undefined>;
  subscriptions(): Promise<Sub[]>;
  /** Open tasks with a reminder on a day that may still be ringing. */
  candidates(now: number): Promise<Candidate[]>;
  /** The keys already sent (`dueKey`). */
  sent(): Promise<Set<string>>;
  /** Marks `key` sent; false when it already was (another scan took it first). */
  claim(key: string): Promise<boolean>;
  /** Takes the claim on `key` back, for a reminder nothing could be delivered for. */
  release(key: string): Promise<void>;
  deliver(v: Vapid, sub: Sub, payload: PushPayload): Promise<Outcome>;
};

/** The reminders in `candidates` not yet due are armed, and a key no candidate has any more (done, moved, deleted) is forgotten. */
function arm(armed: Set<string>, candidates: Candidate[], now: number) {
  const live = new Set<string>();
  for (const { task } of candidates) {
    const at = task.done ? null : remindAt(task);
    if (at === null) continue;
    live.add(dueKey(task));
    if (at > now) armed.add(dueKey(task));
  }
  for (const key of armed) if (!live.has(key)) armed.delete(key);
}

/** One scan: sends every due reminder to every subscription. Returns the keys it sent: not one whose every delivery failed
 *  (or dropped its subscription), which is released to be tried again on the next scan. `armed`: what the scans before this one
 *  saw ahead of its time (kept by the caller from scan to scan; empty after a restart, when `updated` decides alone). */
export async function scan(ports: Ports, now: number, armed = new Set<string>()): Promise<string[]> {
  const v = await ports.vapid();
  if (!v) return [];
  const subs = await ports.subscriptions();
  if (!subs.length) return [];
  const candidates = await ports.candidates(now);
  const due = dueReminders(candidates, await ports.sent(), now, { armed });
  arm(armed, candidates, now);
  const sent: string[] = [];
  for (const { key, task } of due) {
    if (!(await ports.claim(key))) continue;
    const payload = payloadFor(task);
    const outcomes = await Promise.all(subs.map((s) => ports.deliver(v, s, payload)));
    if (outcomes.every((o) => o === "failed" || o === "dropped")) await ports.release(key);
    else sent.push(key);
  }
  return sent;
}

// ---- over PocketBase

const SENT = "collections/push_sent/records";

export const pbPorts = (server: Server): Ports => ({
  vapid,
  subscriptions: () => subscriptions(server),
  async candidates(now) {
    // yesterday on, since a reminder just after midnight may be for the day before the one it rings on
    const filter = `done = "" && when >= ${lit(addDays(localDay(now), -1))} && when <= ${lit(localDay(now))} && remind != ""`;
    const out: Candidate[] = [];
    for (let page = 1; ; page++) {
      const j = await pb.call(server, `collections/tasks/records?perPage=200&page=${page}&skipTotal=1&filter=${encodeURIComponent(filter)}`);
      for (const r of j.items) out.push({ task: taskOf(r), updated: time(r.updated) });
      if (j.items.length < 200) return out;
    }
  },
  async sent() {
    const keys = new Set<string>();
    for (let page = 1; ; page++) {
      const j = await pb.call(server, `${SENT}?fields=key&perPage=500&page=${page}&skipTotal=1`);
      for (const r of j.items) keys.add(String(r.key));
      if (j.items.length < 500) return keys;
    }
  },
  /** The claim is a record under an id of this claim's own. A send whose answer was lost is sent again under that id and, finding
   *  it taken, reads the record back: it is ours (the first landed: the claim is held), never "taken by another scan", which would
   *  leave the reminder claimed and never sent. A taken key under another id is another scan's. */
  async claim(key) {
    const id = pb.recordId();
    try {
      await createdUnder(() => pb.call(server, SENT, pb.json("POST", { id, key })), async () => {
        try { return await pb.call(server, `${SENT}/${id}`); } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
      }, { unanswered: pb.unanswered });
      return true;
    } catch (e) {
      if (e instanceof Conflict || (e instanceof HttpError && e.status === 400 && e.body?.data?.key?.code === "validation_not_unique")) return false;   // the unique key is taken
      throw e;
    }
  },
  async release(key) {
    const j = await pb.call(server, `${SENT}?fields=id&perPage=1&skipTotal=1&filter=${encodeURIComponent(`key = ${lit(key)}`)}`);
    for (const r of j.items) await pb.call(server, `${SENT}/${r.id}`, { method: "DELETE" });
  },
  deliver: (v, sub, payload) => deliver(server, v, sub, payload),
});

/** Claims older than `SENT_KEPT` deleted: a reminder is never due that long after its time. */
export async function prune(server: Server, now: number): Promise<void> {
  const before = new Date(now - SENT_KEPT).toISOString().replace("T", " ");
  const j = await pb.call(server, `${SENT}?fields=id&perPage=200&skipTotal=1&filter=${encodeURIComponent(`created < ${lit(before)}`)}`);
  for (const r of j.items) await pb.call(server, `${SENT}/${r.id}`, { method: "DELETE" });
}

/** Scans every minute (and once now), and prunes hourly. A failed scan is logged and the next one tries again. */
export function startReminders(server: Server): void {
  void vapid().then((v) => { if (v && !process.env.TZ) console.error("agent: TZ is not set: reminders are read in the container's zone (UTC), which must be the owner's; set TZ in .env"); });
  const ports = pbPorts(server), armed = new Set<string>();
  let running: Promise<void> | undefined, last = 0;
  const tick = () => {
    if (running) return;
    const now = Date.now();
    running = (async () => {
      await scan(ports, now, armed);
      if (now - last >= 3_600_000) { await prune(server, now); last = now; }
    })().catch((e) => console.error(`agent: reminders failed: ${(e as Error).message}`)).finally(() => { running = undefined; });
  };
  tick();
  setInterval(tick, EVERY);
}
