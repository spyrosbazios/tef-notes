// Notes leaving the list: handed to the chat agent, or shared out as markdown files. Both act on the phone's own copy of
// the notes (`paths`, a note's own ⋮ or the selection bar), so they work offline.
import { router } from "expo-router";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";
import { replying } from "@/agent/background";
import { aboutNotes, fileNameOf } from "@/core/handoff";
import { noteText, useNotes } from "./notes";
import { useChats } from "./chats";

/** A new chat on the Ask tab, its message field pre-filled to name these notes (`aboutNotes`) and left for the owner to
 *  finish and send. While a reply is streaming the text goes into that chat's field instead: a switch would cut it off. */
export function askAbout(paths: string[]) {
  const { notes } = useNotes.getState();
  const named = paths.flatMap((p) => (notes[p] ? [{ path: p, title: notes[p].title }] : []));
  if (!named.length) return;
  useChats.getState().startDraft(aboutNotes(named), replying() != null);
  router.navigate("/ask");
}

/** Each note's whole file through the system share sheet, named as in the notes folder (`20261005-garage.md`). The
 *  sheet takes one file at a time, so several notes come one after another. Photos stay on the server: the body's links
 *  point at them, as in the file the CLI and the web app export. */
export async function exportNotes(paths: string[]) {
  try {
    const files = paths.flatMap((p) => { const text = noteText(p); return text == null ? [] : [{ name: fileNameOf(p), text }]; });
    if (!files.length) throw new Error("The text of these notes isn't on this phone yet.");
    if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
    const dir = new Directory(Paths.cache, "export");
    dir.create({ idempotent: true, intermediates: true });
    for (const f of files) {
      const file = new File(dir, f.name);
      file.write(f.text);
      await Sharing.shareAsync(file.uri, { mimeType: "text/markdown", UTI: "net.daringfireball.markdown", dialogTitle: f.name });
    }
  } catch (e) {
    Alert.alert("Couldn't export", e instanceof Error ? e.message : String(e));
  }
}
