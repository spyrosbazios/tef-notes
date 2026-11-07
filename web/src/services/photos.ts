// A note's photos, PDFs and drawings: records in `attachments` under the note's id, the body pointing at them as
// `../attachments/<id>/<name>`. The bytes are at photoUrl, on this page's own origin.
import { photoUrl, type Photo } from "@/core/pocketbase";
import { api, lit, orNull } from "./api";

const photo = (r: any): Photo => ({ rec: r.id, note: r.note, name: r.name, file: r.file });

export async function list(note: string): Promise<Photo[]> {
  const { data } = await api.get("collections/attachments/records", {
    params: { fields: "id,note,name,file", filter: `note = ${lit(note)}`, perPage: 500, skipTotal: 1 },
  });
  return data.items.map(photo);
}

/** Every note's photos at once: what the list draws its thumbnails from, one request however many notes have one. */
export async function all(): Promise<Photo[]> {
  const out: Photo[] = [];
  for (let page = 1; ; page++) {
    const { data } = await api.get("collections/attachments/records", { params: { fields: "id,note,name,file", sort: "name", perPage: 500, page, skipTotal: 1 } });
    out.push(...data.items.map(photo));
    if (data.items.length < 500) return out;
  }
}

export const url = (p: Photo) => photoUrl({ url: location.origin }, p);

/** Conflict: the note has a photo by that name already. */
export async function upload(note: string, name: string, file: Blob): Promise<Photo> {
  const form = new FormData();
  form.append("note", note);
  form.append("name", name);
  form.append("file", file, name);
  return photo((await api.post("collections/attachments/records", form)).data);
}

/** A record gone, already gone being done: a drawing is replaced by deleting its files and uploading them again (an attachment never changes). */
export async function remove(rec: string): Promise<void> {
  await orNull(api.delete(`collections/attachments/records/${rec}`));
}
