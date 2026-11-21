// Every write the CLI makes that carries content, in one place. `TEF_NOTES_AGENT=1` marks an outside agent's writes: a note
// or task is `tainted` (the in-app assistant treats it like web text), a tag's description is `describedBy: "agent"` (the
// server and the auto-tagger don't take it for the owner's). tefnotes.ts calls nothing of core's that writes a note, a task
// or a tag except through `writer`, so a command can't forget the mark (cli/test checks that, and what goes over the wire).
// Not here, because they carry no content a reader could be misled by: deletions, links, attachments (their note is marked
// by the write that links or replaces them) and tag renames (the server's route).
import { importNotes, type ImportTally, type Source, type ImportLine } from "@/core/import";
import * as pb from "@/core/pocketbase";
import { createTag, updateTag, type TagDef, type TagFields, type TagMark } from "@/core/tags";
import type { Task } from "@/core/todo";

/** What the environment says every write carries. */
export const markOf = (env: Record<string, string | undefined>): pb.Mark => (env.TEF_NOTES_AGENT === "1" ? { tainted: true } : {});

export function writer(mark: pb.Mark) {
  const tagMark: TagMark | undefined = mark.tainted ? "agent" : undefined;
  return {
    /** Whether the writes are an agent's. */
    marks: mark.tainted === true,
    notes: {
      create: (s: pb.Server, rec: string, path: string, text: string) => pb.create(s, rec, path, text, mark),
      update: (s: pb.Server, e: pb.Entry, text: string) => pb.update(s, e, text, mark),
    },
    tasks: {
      create: (s: pb.Server, t: Task) => pb.tasks.create(s, t, mark),
      update: (s: pb.Server, id: string, rev: number, fields: Partial<Omit<Task, "id">>) => pb.tasks.update(s, id, rev, fields, mark),
    },
    tags: {
      /** The mark rides only with a description being written: a colour change leaves who wrote the description as it was. */
      create: (s: pb.Server, t: TagFields) => createTag(s, t, tagMark),
      update: (s: pb.Server, was: TagDef, t: TagFields) => updateTag(s, was.rec, t, t.description.trim() === was.description.trim() ? undefined : tagMark),
    },
    importNotes: (s: pb.Server, src: Source, o: { dry: boolean; update: boolean; today: string; onLine?: (l: ImportLine) => void }): Promise<ImportTally> =>
      importNotes(s, src, { ...o, mark }),
  };
}
