// How the realtime stream reads its own end (services/realtime.ts): PocketBase's idle and maximum times are a quiet reopen, a drop
// after it opened a reopen and a pull, a stream that never opened the server out of reach.
import { expect, test } from "bun:test";
import { dead, endOf, IDLE, MAX } from "@/services/realtime";

test("a stream's end: PocketBase's own timeouts, a drop, or a server out of reach", () => {
  const t0 = 1_000_000;
  expect(endOf({ opened: null, last: 0, now: t0 })).toBe("unreachable");
  expect(endOf({ opened: t0, last: t0 + 60_000, now: t0 + 60_000 + IDLE })).toBe("timeout");     // 5 minutes with nothing sent
  expect(endOf({ opened: t0, last: t0 + MAX - 1000, now: t0 + MAX })).toBe("timeout");           // 30 minutes, events or not
  expect(endOf({ opened: t0, last: t0 + 60_000, now: t0 + 90_000 })).toBe("lost");              // a wifi change, a sleep
});

test("a stream quiet for longer than PocketBase lets one be is gone, whatever the browser says", () => {
  expect(dead(0, IDLE)).toBe(false);
  expect(dead(0, IDLE + 60_000)).toBe(true);
});
