// Notes leaving the app as files: one note as its `.md`, several (or all) as a `.zip` laid out as the notes' own links
// expect — `notes/<file>.md` and `attachments/<note-id>/<name>` — so the files read the same outside the app. The layout
// is the core's (`exportPlan`, shared with the CLI's `tefnotes export`).
import { strToU8, zipSync, type Zippable } from "fflate";
import { exportPlan, fileNameOf } from "@/core/handoff";
import * as photos from "@/services/photos";
import type { NoteRec } from "@/services/notes";

/** `data` saved by the browser as `name`. */
function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One note as its `.md`, as it is stored (frontmatter and all). */
export const downloadMarkdown = (n: Pick<NoteRec, "path" | "text">) => save(fileNameOf(n.path), n.text, "text/markdown;charset=utf-8");

/** These notes and the photos and PDFs their bodies link, in one zip. `name`: the zip's file name. */
export async function downloadZip(recs: Pick<NoteRec, "path" | "text">[], name: string) {
  const plan = exportPlan(recs, await photos.all());
  const files: Zippable = {};
  for (const e of plan) files[`notes/${fileNameOf(e.path)}`] = strToU8(e.text);
  await Promise.all(plan.flatMap((e) => e.files).map(async (f) => {
    const r = await fetch(photos.url(f.photo));
    if (!r.ok) throw new Error(`${f.path}: HTTP ${r.status}`);
    files[f.path] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }];            // JPEGs and PDFs don't shrink: stored, not deflated
  }));
  save(name, zipSync(files) as Uint8Array<ArrayBuffer>, "application/zip");
  return plan.length;
}

/** The notes at hand: one is its `.md`, more are a zip. */
export async function downloadNotes(recs: NoteRec[]) {
  if (recs.length === 1) { downloadMarkdown(recs[0]); return; }
  await downloadZip(recs, `tefnotes-${recs.length}-notes.zip`);
}

/** The system share sheet takes files here: a touch screen on a browser with Web Share for files (Android's Chrome, an
 *  installed app). A desktop browser that has it too still downloads: a file is what one wants there. */
export const sharesFiles = () =>
  matchMedia("(pointer: coarse)").matches && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "a.md", { type: "text/markdown" })] });

/** These notes' `.md` files through the share sheet, as the phone shares them (the photos stay on the server: the body's links
 *  point at them). Closing the sheet is no failure. */
export async function shareNotes(recs: Pick<NoteRec, "path" | "text">[]) {
  const files = recs.map((n) => new File([n.text], fileNameOf(n.path), { type: "text/markdown" }));
  try { await navigator.share({ files }); } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) throw e; }
}
