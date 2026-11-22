// What Fish Audio has cost: the agent keeps its own record of every billed use (Fish answers only the balance left, no history),
// and `GET /agent/fish/usage?week=&month=` sums it since the two starts the client names (its own week and month, in its own
// time zone) and adds Fish's balance. Prices: core/talk.ts. A cost here is the list price of what was sent, not Fish's invoice.
import { earCostOf } from "./talk";

export const FISH_USAGE = "/agent/fish/usage";

/** One billed use: a Talk conversation (the ear's open seconds and the voice's bytes) or a piece of dictation (its audio). */
export type FishUse = { kind: "talk" | "dictation"; seconds: number; bytes: number; cost: number };

/** Uses summed over a period: the cost of each kind in US dollars, and the seconds listened to. */
export type FishSpend = { talk: number; dictation: number; total: number; seconds: number };

export type FishUsage = {
  week: FishSpend;
  month: FishSpend;
  /** Fish's API credit left, in US dollars; null when it could not be asked. */
  balance: number | null;
  /** When the record begins (ms), null while it is empty: a period starting before it is only partly counted. */
  since: number | null;
};

/** What a piece of dictation costs: Fish bills the file's whole length, rounded up to the second, at the ear's rate. */
export const dictationCostOf = (seconds: number) => earCostOf(Math.ceil(Math.max(0, seconds)));

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

const spendOf = (raw: unknown): FishSpend => {
  const s = obj(raw);
  return { talk: num(s.talk), dictation: num(s.dictation), total: num(s.total), seconds: num(s.seconds) };
};

/** The defensive reader of the route's answer. */
export function fishUsageOf(raw: unknown): FishUsage {
  const u = obj(raw);
  return {
    week: spendOf(u.week),
    month: spendOf(u.month),
    balance: typeof u.balance === "number" && Number.isFinite(u.balance) ? u.balance : null,
    since: typeof u.since === "number" && Number.isFinite(u.since) ? u.since : null,
  };
}

/** The starts (ms) of `now`'s week (Monday) and month, at midnight in the zone `now` is read in. */
export function periodStarts(now: Date): { week: number; month: number } {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day);
  week.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return { week: week.getTime(), month: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
}
