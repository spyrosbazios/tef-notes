// A folder of Markdown brought in as notes: `importPlan` (handoff.ts) carried out against the server. One run for the
// CLI (`tefnotes import`, files on disk) and the web app (Settings → Import, a picked folder or an export's zip); each
// hands it a `Source` over its own files.
import { importPlan } from "./handoff";
import { noteIdOf } from "./notes";
import * as pb from "./pocketbase";

/** The files to import: every path, relative with `/`, and how to read one. */
export type Source = { paths: string[]; text: (path: string) => Promise<string>; blob: (path: string) => Promise<Blob> };

/** One note's fate: `new`, `update`d over, `same` text already there, or `skip`ped because its id is taken. */
export type ImportLine = { what: "new" | "update" | "same" | "skip"; from: string; id: string; files: number };
export type ImportTally = { found: number; taken: number; made: number; updated: number; same: number; skipped: number; files: number };

async function inBatches<T>(items: T[], fn: (x: T) => Promise<void>, size: number) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Every `.md` in `src` as a note. A taken id is left alone unless `update`, and then written over at the rev just read;
 *  an attachment the note already has by that name stays. `dry`: decide and report, write nothing. */
export async function importNotes(s: pb.Server, src: Source, o: { dry: boolean; update: boolean; today: string; onLine?: (l: ImportLine) => void }): Promise<ImportTally> {
  const md = src.paths.filter((f) => /\.md$/i.test(f));
  const plan = importPlan(await Promise.all(md.map(async (from) => ({ from, text: await src.text(from) }))), new Set(src.paths), o.today);
  const there = new Map((await pb.list(s)).map((e) => [e.path, e]));
  const t: ImportTally = { found: plan.length, taken: plan.filter((e) => there.has(e.path)).length, made: 0, updated: 0, same: 0, skipped: 0, files: 0 };
  await inBatches(plan, async (e) => {
    const had = there.get(e.path), id = noteIdOf(e.path), line = (what: ImportLine["what"]) => o.onLine?.({ what, from: e.from, id, files: e.files.length });
    if (had && !o.update) { t.skipped++; return line("skip"); }
    const cur = had ? await pb.get(s, had.rec) : null;
    const same = !!cur && cur.text === e.text;
    if (same) t.same++;
    line(!cur ? "new" : same ? "same" : "update");
    if (o.dry) return;
    if (!cur) { await pb.create(s, e.path, e.text); t.made++; }
    else if (!same) {
      if (!(await pb.update(s, cur, e.text))) throw new Error(`${e.path} was deleted meanwhile`);
      t.updated++;
    }
    const have = new Set(cur ? (await pb.photos(s, id)).map((p) => p.name) : []);
    for (const f of e.files) {
      if (have.has(f.name)) continue;
      try { await pb.upload(s, id, f.name, await src.blob(f.from)); t.files++; } catch (err) {
        if (!(err instanceof pb.Conflict)) throw err;                     // added meanwhile: it is there
      }
    }
  }, 4);
  return t;
}
