// The owner's preferences as the server reads them (@/core/prefs): the companion's feeds and the lens it sets, and the
// rules for the agent's writes (@/core/actions) and their note actions (@/core/note-actions), read for every turn rather than
// taken from a request. Written whole by the few things the server changes itself: the companion's lens, a note action the
// agent saves.
import * as pb from "@/core/pocketbase";
import { PREFS_KEY, prefsOf, type Prefs } from "@/core/prefs";

/** The owner's record (null before the first save) and its data as `prefsOf` reads it. */
export async function ownerPrefs(server: pb.Server): Promise<{ rec: string | null; prefs: Prefs }> {
  const j = await pb.call(server, `collections/prefs/records?filter=${encodeURIComponent(`key = ${pb.lit(PREFS_KEY)}`)}&perPage=1&skipTotal=1`);
  const record = j.items?.[0];
  return { rec: record?.id ?? null, prefs: prefsOf(record?.data) };
}

/** The owner's preferences written whole: over their record (`rec`), or as its first save. */
export async function saveOwnerPrefs(server: pb.Server, rec: string | null, data: Prefs): Promise<void> {
  await (rec
    ? pb.call(server, `collections/prefs/records/${rec}`, pb.json("PATCH", { data }))
    : pb.call(server, "collections/prefs/records", pb.json("POST", { key: PREFS_KEY, data })));
}
