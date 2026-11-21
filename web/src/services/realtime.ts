// PocketBase's realtime feed: an edit made on the phone shows up here within a second, not at the next refetch. Only the tab that
// leads runs it (lib/tab-sync.ts), and passes on to the others what it hears besides records.
// The stream is an EventSource; the subscription is a POST naming the stream's client id, as PocketBase expects. A note, task or
// link record is handed over whole (`heard`), for the sync engine to take in as a pull of that record would (core/sync.ts
// `takeHeard`); a pull of everything (`gap`) is only for when events may have been missed: the first connect and any reconnect
// after a drop, never after PocketBase's own timeouts.
// PocketBase v0.40.6 closes a stream that has sent nothing for 5 minutes (`IdleTimeout`) and any stream after 30 (`MaxTimeout`),
// with no keepalive in between (apis/realtime.go: https://github.com/pocketbase/pocketbase/blob/v0.40.6/apis/realtime.go).
// Such a close is not the server going away: the stream is reopened at once, quietly. Any other drop is reopened at once too
// (a wifi change, the laptop waking), and is "unreachable" only when that reopen fails, then reopened on a growing delay.
import { heardOf } from "@/core/record-protocol";
import type { Heard } from "@/core/sync";
import { note } from "@/lib/net";
import type { Relayed, StreamHandlers } from "@/lib/tab-sync";
import { api, message } from "./api";

/** PocketBase's own stream timeouts (see above), and the slack a close counts as one of them within. */
export const IDLE = 5 * 60_000, MAX = 30 * 60_000, SLACK = 15_000;

/** What a stream's end was. `timeout`: PocketBase's idle or maximum time came, so nothing was missed before it (reopen at once,
 *  no pull); `lost`: it dropped after it had opened (reopen at once, then pull: events may have gone by); `unreachable`: it
 *  never opened (the server is out of reach: reopen later). `opened`: when it opened, null if it never did; `last`: its last
 *  event. */
export function endOf(o: { opened: number | null; last: number; now: number }): "timeout" | "lost" | "unreachable" {
  if (o.opened == null) return "unreachable";
  return o.now - o.last >= IDLE - SLACK || o.now - o.opened >= MAX - SLACK ? "timeout" : "lost";
}

/** A stream that has heard nothing for longer than PocketBase lets one stay quiet is gone, whatever the browser says (a page
 *  frozen in the background, a connection dropped without a word). */
export const dead = (last: number, now: number) => now - last > IDLE + SLACK;

const TOPICS = ["notes", "attachments", "tasks", "links", "chats", "prefs"] as const;
const RETRY = 1000, RETRY_MAX = 60_000, BRIEF = 10_000;

/** Runs the feed until the returned stop: records to `heard`, `gap` when events may have been missed (and a full pull is due),
 *  `feed` why the subscription failed (undefined once it holds), `relay` the rest. Closed, not retried, while the browser says
 *  offline; reopened at once when it says online again. */
export function watch({ heard, gap, feed, relay }: StreamHandlers): () => void {
  let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, wait = RETRY;
  /** This connection's open time and last event; whether its subscription, once made, follows a gap. */
  let opened: number | null = null, last = 0, missed = true;
  const close = () => { clearTimeout(retry); es?.close(); es = null; };
  const later = () => { retry = setTimeout(connect, wait); wait = Math.min(wait * 2, RETRY_MAX); };

  function connect() {
    close();
    opened = null;
    const mine = es = new EventSource("/api/realtime");
    const heardFrom = () => { last = Date.now(); };
    mine.onopen = () => { opened = last = Date.now(); note("reached"); };
    mine.onerror = () => {
      if (es !== mine) return;
      const end = endOf({ opened, last, now: Date.now() });
      close();
      if (end === "unreachable") { note("unreachable"); missed = true; later(); return; }
      missed ||= end === "lost";
      // A stream that drops as soon as it opens (a proxy cutting it) is reopened on the growing delay, not in a loop
      if (opened != null && Date.now() - opened < BRIEF) later(); else connect();
    };
    mine.addEventListener("PB_CONNECT", (ev) => {
      heardFrom();
      const { clientId } = JSON.parse((ev as MessageEvent).data);
      api.post("realtime", { clientId, subscriptions: TOPICS }).then(() => {
        if (es !== mine) return;
        wait = RETRY;
        feed(undefined);
        if (missed) { missed = false; gap(); }
      }, (e: unknown) => {
        if (es !== mine) return;
        // Not subscribed: the stream tells nothing. Open a new one (a new client id) after a growing delay, and say why meanwhile
        feed(`Live updates are off: ${message(e)}`);
        missed = true;
        close();
        later();
      });
    });
    const record = (topic: Heard["topic"]) => (ev: Event) => {
      heardFrom();
      const { action, record: r } = JSON.parse((ev as MessageEvent).data);
      const h = heardOf(topic, action, r);
      if (h) heard(h); else gap();                           // a record not of the shape known here: read everything again
    };
    for (const topic of ["notes", "tasks", "links"] as const) mine.addEventListener(topic, record(topic));
    const other = (e: (data: { record?: unknown }) => Relayed) => (ev: Event) => { heardFrom(); relay(e(JSON.parse((ev as MessageEvent).data))); };
    mine.addEventListener("attachments", other(() => ({ topic: "attachments" })));
    mine.addEventListener("chats", other(() => ({ topic: "chats" })));
    mine.addEventListener("prefs", (ev) => {
      heardFrom();
      const { action, record: r } = JSON.parse((ev as MessageEvent).data);
      if (action !== "delete") relay({ topic: "prefs", record: r });
    });
  }

  const online = () => { wait = RETRY; missed = true; connect(); };
  // Offline the stream can only fail: stop reopening it until the browser says it is back
  const offline = () => close();
  /** A stream gone quiet beyond PocketBase's idle time, or one the browser kept through the back-forward cache, is reopened. */
  const check = () => { if (es && opened != null && dead(last, Date.now())) { missed = true; connect(); } };
  const shown = () => { if (document.visibilityState === "visible") check(); };
  const restored = (e: PageTransitionEvent) => { if (e.persisted) { missed = true; connect(); } };
  const watchdog = setInterval(check, IDLE);
  connect();
  addEventListener("online", online);
  addEventListener("offline", offline);
  addEventListener("pageshow", restored);
  document.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(watchdog);
    removeEventListener("online", online);
    removeEventListener("offline", offline);
    removeEventListener("pageshow", restored);
    document.removeEventListener("visibilitychange", shown);
    close();
  };
}
