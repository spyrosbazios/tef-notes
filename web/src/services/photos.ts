// A note's photos, PDFs and drawings through the shared protocol (core/record-protocol.ts `attachments`): records under the
// note's id, the body pointing at them as `../attachments/<id>/<name>`. The bytes are at photoUrl, on this page's own origin.
import type { Photo } from "@/core/photos";
import { attachments } from "@/core/record-protocol";
import { photoUrl } from "@/core/server-urls";
import { directTransport } from "./records";

export const list = (note: string) => attachments.list(directTransport, note);
/** Every note's at once: what the list draws its thumbnails from. */
export const all = () => attachments.list(directTransport);
export const url = (p: Photo) => photoUrl({ url: location.origin }, p);
/** Conflict: the note has one by that name already. */
export const upload = (note: string, name: string, file: Blob) => attachments.upload(directTransport, note, name, file);
/** A record gone, already gone being done: a drawing is replaced by deleting its files and uploading them again (an attachment
 *  never changes). */
export const remove = (rec: string) => attachments.remove(directTransport, rec);
