// A share filed through the server's clip routes, as the browser extension files a page (core/clip.ts has the shapes,
// extension/AGENTS.md the contract): suggest where JEV would put it, then save where the owner chose. What it needs of
// the phone is here: the picture's two JPEGs (the one stored, downscaled as a photo is; the one JEV looks at) and, after
// a save, the sync that brings the note or task it touched down. Nothing is written until save.
import { File, UploadType } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { type ClipPage, type ClipResult, sendsFile, type Suggestions, type Target } from "@/core/clip";
import { LOOK_QUALITY, lookSize } from "@/core/photos";
import * as pb from "@/core/pocketbase";
import { downscale, type Picture } from "./attachments";
import { serverOf } from "./keys";
import { noteText, syncNotes } from "./notes";
import { syncTodo, useTodo } from "./todo";

const server = () => {
  const s = serverOf();
  if (!s) throw new Error("Set the notes server in Settings.");
  return s;
};

/** The picture as JEV looks at it, base64: its size is read first (a share may not say) and the render released at once,
 *  a 12 MP bitmap being ~48 MB. */
export async function lookOf(pic: Picture): Promise<string> {
  let { width, height } = pic;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulate(pic.uri).renderAsync();
    ({ width, height } = probe);
    probe.release();
  }
  const ctx = ImageManipulator.manipulate(pic.uri).resize(lookSize(width, height));
  try {
    const img = await ctx.renderAsync();
    try {
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: LOOK_QUALITY, base64: true });
      if (!out.base64) throw new Error("the picture could not be read");
      return out.base64;
    } finally { img.release(); }
  } finally { ctx.release(); }
}

/** Where the share fits, among the notes and open tasks. Throws when the server can't be reached, or has no answer. */
export async function suggestClip(page: ClipPage, note: string, pic?: Picture): Promise<Suggestions> {
  return pb.clipSuggest(server(), page, note, pic ? await lookOf(pic) : undefined);
}

/** Save the share where `target` says, then sync what it touched so the phone has it. A picture goes up as the
 *  note's attachment (a task keeps none). `summary`: the owner ticked "Add a summary" (the result says what became of it).
 *  The result names the note or task to open. */
export async function saveClip(page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, pic?: Picture): Promise<ClipResult> {
  const s = server();
  let result: ClipResult;
  if (pic && sendsFile(page, target)) {
    const stored = await downscale(pic), to = pb.clipTo(s, page, line, target, note, summary);
    try {
      const r = await new File(stored.uri).upload(to.url, { uploadType: UploadType.MULTIPART, fieldName: "file", mimeType: "image/jpeg", parameters: to.fields });
      result = pb.clipped(r.status, r.body);
    } finally {
      try { const f = new File(stored.uri); if (f.exists) f.delete(); } catch { /* a cache file: the system clears it */ }
    }
  } else {
    result = await pb.clipSave(s, page, line, target, note, summary);
  }
  await arrived(result, !!pic);
  return result;
}

/** Until what the save touched is on the phone, to open it. A sync already running when this one is asked for has it
 *  coalesce into a rerun after, so a few rounds; the save itself is done, so giving up is no failure. */
async function arrived(r: ClipResult, photos: boolean) {
  const here = () => (r.kind === "task" ? !!useTodo.getState().tasks[r.id] : noteText(r.path) != null);
  for (let i = 0; i < 3 && (i === 0 || !here()); i++) await (r.kind === "task" ? syncTodo() : syncNotes({ photos }));
}
