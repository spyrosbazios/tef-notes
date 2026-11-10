// One change to many notes: each is its own rev-checked write (hooks/notes.ts), all at once, and what failed is
// reported together instead of stopping at the first. A write redoes its change on a note that moved meanwhile, so
// a selection can't overwrite what another device just did.
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { archivePatch } from "@/core/bulk";
import type { FlagEdit } from "@/core/notes";
import { applyTags } from "@/core/tags";
import { deleteNote, NOTES, setFlags, write } from "@/hooks/notes";
import { message } from "@/services/api";
import type { NoteRec } from "@/services/notes";

/** The notes at `paths`, as the cache has them now, and what can be done to all of them. */
export function useBulk() {
  const qc = useQueryClient();
  const cached = (paths: string[]) => (qc.getQueryData<NoteRec[]>(NOTES) ?? []).filter((n) => paths.includes(n.path));

  /** `change` on each note; failures summed up in one toast. Returns how many went through. */
  async function run(paths: string[], what: string, change: (r: NoteRec) => Promise<unknown>): Promise<number> {
    const recs = cached(paths);
    const out = await Promise.allSettled(recs.map(change));
    const bad = out.flatMap((o) => (o.status === "rejected" ? [message(o.reason)] : []));
    if (bad.length) toast.error(`Couldn't ${what} ${bad.length} of ${recs.length} notes: ${[...new Set(bad)].join("; ")}`);
    return recs.length - bad.length;
  }

  return {
    flags: (paths: string[], f: FlagEdit) => run(paths, "update", (r) => setFlags(qc, r, f)),
    tags: (paths: string[], add: string[], remove: string[] = []) => run(paths, "tag", (r) => write(qc, r, (t) => applyTags(r.path, t, add, remove))),
    /** Archive them (or bring them all back when all are archived, core/bulk.ts archivePatch), with an Undo that puts each
     *  one's archive and pin back as they were. */
    archive: async (paths: string[]) => {
      const before = cached(paths), patch = archivePatch(before.map((r) => r.note));
      const n = await run(paths, patch.archived ? "archive" : "unarchive", (r) => setFlags(qc, r, patch));
      if (!n) return;
      const undo = () => void Promise.allSettled(before.map((was) => {
        const now = cached([was.path])[0];
        return now ? setFlags(qc, now, { archived: was.note.archived, pinned: was.note.pinned }) : null;
      }));
      const what = n === 1 ? "1 note" : `${n} notes`;
      toast(patch.archived ? `Archived ${what}` : `Brought back ${what}`, { action: { label: "Undo", onClick: undo } });
    },
    remove: async (paths: string[]) => {
      const n = await run(paths, "delete", (r) => deleteNote(qc, r));
      if (n) toast(n === 1 ? "Deleted 1 note" : `Deleted ${n} notes`);
    },
  };
}
