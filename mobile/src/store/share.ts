// A share from another app, held between the layout (which reads the intent) and the Share screen (which acts on
// it). Memory only: a share left on the screen is dropped. The two actions — a note of its own, or the agent — live here too.
import { create } from "zustand";
import { noteIdOf, parseNote } from "@/core/notes";
import { askText, bodyFor, titleFor, type Shared } from "@/core/share";
import { localDay } from "@/core/time";
import { attachFiles, attachPdfs } from "./attachments";
import { useChats } from "./chats";
import { dirty, noteText, syncNotes, useNotes } from "./notes";

export const useShare = create<{ shared: Shared | null }>()(() => ({ shared: null }));

/** Nothing is being shared any more. */
export const dropShare = () => useShare.setState({ shared: null });

const two = (n: number) => String(n).padStart(2, "0");

/** The shared thing as a note of its own: the link and text as the body, the photos and PDFs attached under them.
 *  `filesOnly`: a note for the files alone, titled by the clock, for the agent to retitle. Returns the note's path. */
export async function saveShared(s: Shared, pageTitle: string | null, filesOnly = false): Promise<string> {
  const d = new Date(), { create, write } = useNotes.getState();
  const path = filesOnly
    ? create(`Photos ${localDay()} ${two(d.getHours())}:${two(d.getMinutes())}`, { body: "" })
    : create(titleFor(s, pageTitle), { body: bodyFor(s, pageTitle) });
  if (s.images.length || s.pdfs.length) {
    const id = noteIdOf(path), lines = [];
    if (s.images.length) lines.push((await attachFiles(id, s.images)).markdown);
    if (s.pdfs.length) lines.push((await attachPdfs(id, s.pdfs)).markdown);
    const text = noteText(path);
    if (text != null) {
      const n = parseNote(path, text), body = `${n.body.trimEnd()}\n\n${lines.join("\n\n")}\n`.replace(/^\n+/, "");
      write(path, text.slice(0, text.length - n.body.length) + body);
    }
  }
  syncNotes();
  return path;
}

/** Hand it to the server's agent: photos and PDFs go in a note first (the agent can't attach files) and are synced up for it,
 *  then a fresh chat opens with the share as its first message — unless a reply is streaming, which the message then joins. */
export async function shareWithAgent(s: Shared, pageTitle: string | null, replying: boolean): Promise<void> {
  const filesAt = s.images.length || s.pdfs.length ? await saveShared(s, pageTitle, true) : undefined;
  if (filesAt) await pushedUp(filesAt);
  useChats.getState().startWith(askText(s, pageTitle, filesAt), replying);
  dropShare();
}

/** Until the note is on the server, where the agent reads it. A sync already running when this one is asked for has
 *  it coalesce into a rerun after, so a few rounds. */
async function pushedUp(path: string) {
  const unsent = () => dirty(useNotes.getState().notes[path]);
  for (let i = 0; i < 3 && unsent(); i++) await syncNotes();
  if (unsent()) throw new Error(`the note for the files didn't reach the server (${useNotes.getState().sync.err ?? "offline?"})`);
}
