// Photos and PDFs on notes: a record each on the notes server (note id + name, the body's `../attachments/<note-id>/<name>`),
// a copy of each under the app's documents on the phone. One taken or picked here is downscaled first (packages/core/src/photos.ts), saved, and queued; uploads go at the end
// of a note sync, held for Wi-Fi when the pref says so. One from the server comes down only when a note showing
// it opens. The preview asks resolveAttachment per image per render, so what's on the phone is a Map in
// memory, read from the attachments table once and kept in step by this file.
import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Network from "expo-network";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { create } from "zustand";
import { isNotePath, noteIdOf, rewriteImagePaths } from "@/core/notes";
import { fit, MAX_PDF, mimeOf, PDF, fileMarkdown, pdfName, photoMarkdown, photoName, QUALITY } from "@/core/photos";
import * as pb from "@/core/pocketbase";
import * as db from "./db";
import { serverOf } from "./keys";
import { usePrefs } from "./prefs";

export type Source = "camera" | "library" | "document";
export type AttachmentSync = { pending: number; waitingWifi: number; err?: string };

const key = (noteId: string, name: string) => `${noteId}/${name}`;
const dirOf = (noteId: string) => new Directory(Paths.document, "attachments", noteId);
const fileOf = (noteId: string, name: string) => new File(Paths.document, "attachments", noteId, name);
/** Added here, not on the server yet. */
const unsent = (a: db.AttachmentRow) => !!a.local && a.rec == null;
const count = () => db.allAttachments().filter(unsent).length;

/** For the Settings and Notes headers: photos still to upload, how many of those wait for Wi-Fi, the last run's first error. */
export const useAttachmentSync = create<AttachmentSync>()(() => ({ pending: count(), waitingWifi: 0 }));

// ---- what's on the phone

let onPhone: Map<string, string> | null = null;
const listeners = new Set<() => void>();

const load = () => new Map(db.allAttachments().flatMap((a) => (a.local ? [[key(a.note_id, a.name), a.local] as const] : [])));
/** `noteId/name` → file:// of every photo with a copy here. */
const have = () => (onPhone ??= load());
const changed = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The file:// URI of a photo's copy on the phone, or undefined. One Map lookup: the preview calls it per image per render. */
export const resolveAttachment = (noteId: string, name: string): string | undefined => have().get(key(noteId, name));

/** The photos `body` points at in its note's folder that aren't on the phone yet: the preview's own scan, so
 *  what's fetched is what it would draw. */
export function missingAttachments(noteId: string, body: string): string[] {
  const out = new Set<string>();
  rewriteImagePaths(body, noteId, (name) => { if (!resolveAttachment(noteId, name)) out.add(name); return undefined; });
  return [...out];
}

/** Off the phone: the file, the row, the Map entry. */
function forget(noteId: string, name: string) {
  const f = fileOf(noteId, name);
  if (f.exists) f.delete();
  db.deleteAttachment(noteId, name);
  if (have().delete(key(noteId, name))) changed();
}

// ---- downloads

const fetching = new Map<string, Promise<string | undefined>>();

/** A photo's file:// URI, fetched from the server first when it isn't on the phone; however many ask at once, one
 *  download. undefined when there's nothing to fetch: no row, not uploaded yet, no server set. */
export function ensureAttachment(noteId: string, name: string): Promise<string | undefined> {
  const k = key(noteId, name), got = have().get(k);
  if (got) return Promise.resolve(got);
  let p = fetching.get(k);
  if (!p) {
    p = download(noteId, name).finally(() => fetching.delete(k));
    fetching.set(k, p);
  }
  return p;
}

async function download(noteId: string, name: string): Promise<string | undefined> {
  const a = db.getAttachment(noteId, name), s = serverOf();
  if (!a?.rec || !a.file || !s) return undefined;
  const f = fileOf(noteId, name);
  dirOf(noteId).create({ intermediates: true, idempotent: true });
  await File.downloadFileAsync(pb.photoUrl(s, { rec: a.rec, file: a.file }), f, { idempotent: true });   // native, straight to disk
  if (db.getAttachment(noteId, name)?.rec !== a.rec) return undefined;      // replaced or deleted while it came down
  db.patchAttachment(noteId, name, { local: f.uri, size: f.size });
  have().set(key(noteId, name), f.uri);
  changed();
  return f.uri;
}

/** The photos `body` shows that aren't on the phone yet, fetched as it's drawn: name → file:// of each landed since,
 *  for `shown` in src/ui/note.tsx, so a memo over the body draws them. Keyed on the names, not the body: typing
 *  doesn't refetch, and a failed download waits for the next time the note is drawn. */
export function useAttachmentsFor(noteId: string, body: string): Record<string, string> {
  const [landed, setLanded] = useState<Record<string, string>>({});
  const need = useMemo(() => missingAttachments(noteId, body).join("/"), [noteId, body]);    // a name has no "/"
  useEffect(() => {
    let live = true;
    for (const name of need ? need.split("/") : []) {
      ensureAttachment(noteId, name).then((uri) => { if (uri && live) setLanded((l) => ({ ...l, [name]: uri })); }, () => {});
    }
    return () => { live = false; };
  }, [noteId, need]);
  return landed;
}

/** A photo's URI for an <Image>: at once when it's on the phone, else once its download lands. */
export function useAttachment(noteId: string, name: string): string | undefined {
  const uri = useSyncExternalStore(subscribe, () => resolveAttachment(noteId, name));
  useEffect(() => { if (!uri) ensureAttachment(noteId, name).catch(() => {}); }, [noteId, name, uri]);
  return uri;
}

// ---- attaching

/** One re-encode, here: the picker hands the original over (quality 1). Bitmaps are released at once, a
 *  12 MP one being ~48 MB. */
export async function downscale(a: Picture) {
  const ctx = ImageManipulator.manipulate(a.uri), size = fit(a.width ?? 0, a.height ?? 0);
  try {
    if (size) ctx.resize(size);
    const img = await ctx.renderAsync();
    try { return await img.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY }); } finally { img.release(); }
  } finally { ctx.release(); }
}

/** An image file on the phone, as the picker, the camera or Android's Share sheet hands it over. */
export type Picture = { uri: string; width: number | null; height: number | null };

/** A PDF file on the phone, as the document picker or Android's Share sheet hands it over. */
export type PdfFile = { uri: string; name: string };

/** Photos or a PDF into a note: a photo from the camera, one or more from the library, or a PDF from the document
 *  picker. Photos are downscaled; each file is saved under the note's folder and queued to upload. Back comes the
 *  body's line for each (an image, a link), or null when cancelled. */
export async function pickAndAttach(noteId: string, source: Source = "library"): Promise<{ markdown: string } | null> {
  if (source === "document") {
    const r = await File.pickFileAsync({ mimeTypes: PDF });
    return r.canceled ? null : attachPdfs(noteId, [{ uri: r.result.uri, name: r.result.name }]);
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
  let res: ImagePicker.ImagePickerResult;
  if (source === "camera") {
    if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("the camera isn't allowed. Turn it on in Android's settings for TEF Notes.");
    res = await ImagePicker.launchCameraAsync(opts);
  } else {
    // Android's photo picker: no permission to ask, it hands over only what's picked
    res = await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true });
  }
  if (res.canceled || !res.assets?.length) return null;
  return attachFiles(noteId, res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
}

/** `add` for each of `items`: it saves one file under the note's folder (`to` names the place) and returns its name,
 *  which is entered as a row queued to upload. All or none: one that fails takes the others down with it, a file
 *  the note doesn't show would upload for nothing. Back come the names. */
async function addAll<T>(noteId: string, items: T[], add: (item: T, taken: Set<string>, to: (name: string) => File) => Promise<string>): Promise<string[]> {
  const taken = new Set(db.getAttachments(noteId).map((a) => a.name)), made: string[] = [];
  try {
    dirOf(noteId).create({ intermediates: true, idempotent: true });
    for (const item of items) {
      const name = await add(item, taken, (n) => fileOf(noteId, n)), f = fileOf(noteId, name);
      taken.add(name); made.push(name);
      db.putAttachment({ note_id: noteId, name, rec: null, file: null, local: f.uri, size: f.size, pushed: null });
      have().set(key(noteId, name), f.uri);
    }
  } catch (e) {
    for (const name of made) forget(noteId, name);
    throw e;
  } finally {
    changed();
    useAttachmentSync.setState({ pending: count() });
  }
  return made;
}

/** Image files already on the phone (picked, taken, or shared in from another app) into a note: each downscaled,
 *  saved under the note's folder and queued to upload; back comes an image line per photo for the body. */
export async function attachFiles(noteId: string, pics: Picture[]): Promise<{ markdown: string }> {
  const at = Date.now();
  const made = await addAll(noteId, pics, async (asset, taken, to) => {
    const out = await downscale(asset), name = photoName(at, taken);
    await new File(out.uri).move(to(name), { overwrite: true });             // a leftover with no row may sit there
    return name;
  });
  return { markdown: photoMarkdown(noteId, made) };
}

/** PDFs already on the phone (from the document picker, or shared in) into a note, as they are: saved under the note's
 *  folder and queued to upload; back comes a link line per PDF for the body. Refused when over what the server takes. */
export async function attachPdfs(noteId: string, pdfs: PdfFile[]): Promise<{ markdown: string }> {
  const labels = new Map<string, string>();
  const made = await addAll(noteId, pdfs, async (pdf, taken, to) => {
    const name = pdfName(pdf.name, taken), f = to(name);
    await new File(pdf.uri).copy(f, { overwrite: true });
    if (f.size > MAX_PDF) { f.delete(); throw new Error(`${pdf.name} is over ${MAX_PDF / 1024 / 1024} MB.`); }
    labels.set(name, pdf.name);
    return name;
  });
  return { markdown: made.map((n) => fileMarkdown(noteId, n, labels.get(n) ?? n)).join("\n") };
}

/** A note made here moved to another id before its first push (store/notes.ts, the laptop took its path): its photos
 *  added here and not uploaded yet go with it — row, file, the Map — or prune would take them for a deleted note's.
 *  Back come the names moved, for the body's image lines. Ones on the server already stay under the old id. */
export function moveAttachments(fromId: string, toId: string): string[] {
  const moved: string[] = [];
  for (const a of db.getAttachments(fromId)) {
    if (a.rec != null) continue;
    const from = fileOf(fromId, a.name), to = fileOf(toId, a.name), had = from.exists;
    if (had) {
      dirOf(toId).create({ intermediates: true, idempotent: true });
      from.moveSync(to, { overwrite: true });
    }
    db.putAttachment({ ...a, note_id: toId, local: to.uri });                // gone already: upload() finds no file and forgets it
    db.deleteAttachment(fromId, a.name);
    have().delete(key(fromId, a.name));
    if (had) have().set(key(toId, a.name), to.uri);
    moved.push(a.name);
  }
  if (moved.length) changed();
  return moved;
}

// ---- sync

type Fail = (what: string, e: unknown) => void;

/** Up with this phone's bytes. The note has a photo by that name already: most likely this same upload, landed once
 *  before the app was killed and the row marked, so that record is taken for this one. */
async function upload(s: pb.Server, a: db.AttachmentRow) {
  const f = fileOf(a.note_id, a.name);
  if (!f.exists) { forget(a.note_id, a.name); throw new Error("gone from the phone before it was sent"); }
  let p: pb.Photo | undefined;
  try {
    const to = pb.uploadTo(s, a.note_id, a.name);
    const r = await f.upload(to.url, { uploadType: UploadType.MULTIPART, fieldName: "file", mimeType: mimeOf(a.name), parameters: to.fields });
    p = pb.uploaded(r.status, r.body, a.name);
  } catch (e) {
    if (!(e instanceof pb.Conflict)) throw e;
    p = (await pb.photos(s, a.note_id)).find((x) => x.name === a.name);
    if (!p) throw e;
  }
  db.patchAttachment(a.note_id, a.name, { rec: p.rec, file: p.file, pushed: Date.now() });
}

/** Photos of notes no longer on the phone (a tombstone is one until its delete is pushed): off the phone. The
 *  server drops a note's photos with the note itself, and the next pull takes the rows of any it still had. */
function prune() {
  const ids = new Set(db.allPaths().filter(isNotePath).map(noteIdOf));
  for (const a of db.allAttachments()) if (!ids.has(a.note_id)) forget(a.note_id, a.name);
}

const onWifi = async () => (await Network.getNetworkStateAsync()).type === Network.NetworkStateType.WIFI;

let running: Promise<void> | null = null, again = false;

/** Removes the photos of deleted notes, then uploads what was attached here, each file on its own. Never rejects:
 *  errors land in useAttachmentSync. Runs at the end of syncNotes, after its push, so a note goes up before its
 *  photos; overlapping calls coalesce into one rerun, as syncNotes's do. */
export function syncAttachments(): Promise<void> {
  if (running) { again = true; return running; }
  const s = serverOf();
  if (!s) return Promise.resolve();
  // Cleared in a .finally, not inside the run: a run with nothing to upload never awaits, and would clear `running`
  // before it was even set, leaving it set for good
  running = run(s).finally(() => {
    running = null;
    if (again) { again = false; syncAttachments(); }
  });
  return running;
}

async function run(s: pb.Server) {
  const errs: string[] = [], fail: Fail = (what, e) => { errs.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); };
  let waitingWifi = 0;
  try {
    onPhone = load();                                                       // a pull may have dropped rows, or a stale copy's `local`
    changed();
    prune();
    const todo = db.allAttachments().filter(unsent);
    if (todo.length && usePrefs.getState().photosWifiOnly && !(await onWifi())) waitingWifi = todo.length;
    else for (const a of todo) await upload(s, a).catch((e) => fail(a.name, e));
  } catch (e) {
    fail("photos", e);
  } finally {
    const err = errs.length ? errs[0].slice(0, 80) + (errs.length > 1 ? ` (+${errs.length - 1} more)` : "") : undefined;
    useAttachmentSync.setState({ pending: count(), waitingWifi, err });
  }
}
