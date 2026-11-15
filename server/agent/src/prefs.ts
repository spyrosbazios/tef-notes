// The owner's preferences as the server reads them (@/core/prefs): the companion's feeds and the lens it sets, and the
// rules for the agent's writes (@/core/actions), read for every turn rather than taken from a request.
import * as pb from "@/core/pocketbase";
import { PREFS_KEY, prefsOf, type Prefs } from "@/core/prefs";

/** The owner's record (null before the first save) and its data as `prefsOf` reads it. */
export async function ownerPrefs(server: pb.Server): Promise<{ rec: string | null; prefs: Prefs }> {
  const j = await pb.call(server, `collections/prefs/records?filter=${encodeURIComponent(`key = ${pb.lit(PREFS_KEY)}`)}&perPage=1&skipTotal=1`);
  const record = j.items?.[0];
  return { rec: record?.id ?? null, prefs: prefsOf(record?.data) };
}
