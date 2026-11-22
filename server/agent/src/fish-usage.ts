// The record of what Fish Audio has cost (contract: packages/core/src/fish-usage.ts): a row per billed use, a Talk conversation
// when it ends and each piece of dictation Fish read, in a sqlite file in TEF_NOTES_DATA. Fish keeps no history we can read, so
// this is the only one: losing the volume loses it. `GET /agent/fish/usage` sums it and adds Fish's balance.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FishSpend, FishUsage, FishUse } from "@/core/fish-usage";
import { credit } from "./fish";
import { key } from "./keys";

export class FishLedger {
  private db: Database;
  constructor(file = ":memory:", private now: () => number = Date.now) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file, { create: true });
    this.db.run("CREATE TABLE IF NOT EXISTS uses (at INTEGER, kind TEXT, seconds REAL, bytes INTEGER, cost REAL)");
    this.db.run("CREATE INDEX IF NOT EXISTS uses_at ON uses (at)");
  }

  record(u: FishUse) {
    if (u.seconds <= 0 && u.bytes <= 0) return;
    this.db.run("INSERT INTO uses VALUES (?, ?, ?, ?, ?)", [this.now(), u.kind, u.seconds, u.bytes, u.cost]);
  }

  since(from: number): FishSpend {
    const rows = this.db.query("SELECT kind, SUM(cost) AS cost, SUM(seconds) AS seconds FROM uses WHERE at >= ? GROUP BY kind").all(from) as { kind: string; cost: number; seconds: number }[];
    const of = (k: string) => rows.find((r) => r.kind === k);
    const talk = of("talk")?.cost ?? 0, dictation = of("dictation")?.cost ?? 0;
    return { talk, dictation, total: talk + dictation, seconds: rows.reduce((s, r) => s + r.seconds, 0) };
  }

  first(): number | null {
    return (this.db.query("SELECT MIN(at) AS at FROM uses").get() as { at: number | null }).at;
  }
}

let shared: FishLedger | undefined;
/** The agent's one ledger, opened on first use. */
export const fishLedger = () => (shared ??= new FishLedger(join(process.env.TEF_NOTES_DATA ?? "./data", "fish-usage.sqlite")));

/** Fish's balance, asked at most once a minute: Settings may be opened often. */
const BALANCE_TTL = 60_000;
let balance: { at: number; value: number | null } | undefined;

async function balanceNow(): Promise<number | null> {
  if (balance && Date.now() - balance.at < BALANCE_TTL) return balance.value;
  const value = await credit().catch((e: Error) => { console.error(`agent: fish balance: ${e.message}`); return null; });
  balance = { at: Date.now(), value };
  return value;
}

const startOf = (v: string | null): number | null => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : null;
};

/** `GET /agent/fish/usage?week=<ms>&month=<ms>`: the spend since each start, Fish's balance, when the record begins. 404 without a key. */
export async function fishUsageRoute(req: Request, ledger = fishLedger()): Promise<Response> {
  if (!(await key("fish"))) return new Response("Fish Audio is off", { status: 404 });
  const q = new URL(req.url).searchParams, week = startOf(q.get("week")), month = startOf(q.get("month"));
  if (week == null || month == null) return new Response("week and month are the periods' starts, in ms", { status: 400 });
  return Response.json({ week: ledger.since(week), month: ledger.since(month), balance: await balanceNow(), since: ledger.first() } satisfies FishUsage);
}
