// Migration file names: `<10-digit timestamp>_<snake_name>.js`, and no two share a timestamp. PocketBase applies them in
// file-name order, so two files with one timestamp run in an order their names decide by accident. The pairs below were
// applied before this check existed; renaming an applied migration would make PocketBase run it again, so they stay.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const APPLIED_PAIRS = new Set(["1792500000", "1793300000", "1794900000"]);
const NAME = /^(\d{10})_[a-z0-9_]+\.js$/;

/** What is wrong with a migrations folder's file names; empty when nothing is. */
export function problems(files: string[]): string[] {
  const out: string[] = [];
  const byStamp = new Map<string, string[]>();
  for (const file of files) {
    const stamp = NAME.exec(file)?.[1];
    if (!stamp) { out.push(`${file}: not <10-digit timestamp>_<snake_name>.js`); continue; }
    byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), file]);
  }
  for (const [stamp, names] of byStamp) {
    if (names.length > 1 && !APPLIED_PAIRS.has(stamp)) out.push(`timestamp ${stamp} is used by ${names.join(", ")}: give the new one its own`);
  }
  return out;
}

if (import.meta.main) {
  const dir = resolve(import.meta.dir, "../server/pb_migrations");
  const found = problems(readdirSync(dir).filter((f) => f.endsWith(".js")));
  if (found.length) { console.error(found.join("\n")); process.exit(1); }
  console.error("Migration file names passed.");
}
