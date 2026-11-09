// The owner's preferences on the server (core/prefs.ts): one record, keyed `owner`. The core's engine (core/prefs-sync.ts)
// calls these as its `PrefsRemote`.
import { PREFS_KEY, prefsOf, type Prefs } from "@/core/prefs";
import { lit } from "@/core/pocketbase";
import type { StoredPrefs } from "@/core/prefs-sync";
import { api } from "./api";

/** The record, or null before any device has saved one. */
export async function get(): Promise<StoredPrefs | null> {
  const items = (await api.get("collections/prefs/records", { params: { filter: `key = ${lit(PREFS_KEY)}`, perPage: 1, skipTotal: 1 } })).data.items;
  return items.length ? { rec: items[0].id, prefs: prefsOf(items[0].data) } : null;
}

/** `prefs` saved whole: over `rec`, or as the record when there is none yet. Conflict: another device created it first. */
export const save = async (rec: string | null, prefs: Prefs): Promise<StoredPrefs> => {
  const r = rec
    ? (await api.patch(`collections/prefs/records/${rec}`, { data: prefs })).data
    : (await api.post("collections/prefs/records", { key: PREFS_KEY, data: prefs })).data;
  return { rec: r.id, prefs: prefsOf(r.data) };
};
