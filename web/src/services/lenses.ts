// Lens definitions on the server (core/lens.ts): a name and its tags. The active lens is this browser's own (hooks/lens.ts).
import { lensColumns, lensOf, type Lens, type LensFields } from "@/core/lens";
import { api, orNull } from "./api";

export const list = async (): Promise<Lens[]> =>
  (await api.get("collections/lenses/records", { params: { perPage: 500, skipTotal: 1, sort: "created,id" } })).data.items.map(lensOf);

/** Conflict: a lens by that name (ignoring case) exists. */
export const create = async (l: LensFields): Promise<Lens> => lensOf((await api.post("collections/lenses/records", lensColumns(l))).data);

export const update = async (rec: string, l: LensFields): Promise<Lens> => lensOf((await api.patch(`collections/lenses/records/${rec}`, lensColumns(l))).data);

/** Already gone is done. */
export async function remove(rec: string): Promise<void> {
  await orNull(api.delete(`collections/lenses/records/${rec}`));
}
