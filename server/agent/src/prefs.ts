// The owner's preferences as the server reads them (@/core/prefs): the companion's feeds and the lens it sets, and the
// rules for the agent's writes (@/core/actions) and their note actions (@/core/note-actions), read for every turn rather than
// taken from a request. Written only through the core's protocol (@/core/prefs-sync), as the web writes them: the record read
// at its rev, the paths changed put over it, a save refused when another device saved since (then read again and redone), so a
// change here never undoes one made on a screen meanwhile. The few things the server changes itself: the companion's lens, a
// note action the agent saves.
import * as pb from "@/core/pocketbase";
import { DEFAULT_PREFS, type Prefs, type PrefsPatch } from "@/core/prefs";
import { patchPrefs, prefsRemote } from "@/core/prefs-sync";

const remote = (server: pb.Server) => prefsRemote(pb.transport(server));

/** The owner's preferences as `prefsOf` reads them: the defaults before the first save. */
export async function ownerPrefs(server: pb.Server): Promise<{ prefs: Prefs }> {
  return { prefs: (await remote(server).get())?.prefs ?? DEFAULT_PREFS };
}

/** `patch` over the owner's preferences (a function is given the current ones, and is run again over the newer record when
 *  another device saved in between): only the paths it names change. */
export async function patchOwnerPrefs(server: pb.Server, patch: PrefsPatch | ((current: Prefs) => PrefsPatch)): Promise<void> {
  await patchPrefs(remote(server), patch);
}
