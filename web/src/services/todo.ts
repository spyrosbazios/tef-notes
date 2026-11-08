// Tasks on the server, as the sync engine (lib/sync.ts) calls them, every request marked `synced` (services/api.ts): records of their own
// (ARCHITECTURE.md), each carrying `rev`, every write a compare-and-swap on it (server/pb_hooks/rev.pb.js). A client names a new record itself (core/pocketbase.ts
// recordId), so a Conflict from a create is "that id is taken". Shapes: core/todo.ts.
import type { Versioned } from "@/core/pocketbase";
import { taskOf, type Task } from "@/core/todo";
import { api, lit, orNull, synced } from "./api";

export type TaskRec = Versioned<Task>;

const PAGE = 500, ID_BATCH = 40;

/** The calls for one collection, its records read by `of`. */
function collection<T extends { id: string }>(name: string, of: (r: any) => T) {
  const rec = (r: any): Versioned<T> => ({ ...of(r), rev: r.rev });
  const path = `collections/${name}/records`;
  return {
    rec,
    /** Every record's id and rev, nothing else: what a pull compares the local copy against. */
    async revs(): Promise<{ id: string; rev: number }[]> {
      const out: { id: string; rev: number }[] = [];
      for (let page = 1; ; page++) {
        const { data } = await api.get(path, { params: { fields: "id,rev", sort: "id", perPage: PAGE, page, skipTotal: 1 }, ...synced });
        out.push(...data.items.map((r: any) => ({ id: r.id, rev: r.rev })));
        if (data.items.length < PAGE) return out;
      }
    },
    /** The records of these ids the server has, a few dozen a request. */
    async getMany(ids: string[]): Promise<Versioned<T>[]> {
      const out: Versioned<T>[] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const filter = ids.slice(i, i + ID_BATCH).map((id) => `id = ${lit(id)}`).join(" || ");
        const { data } = await api.get(path, { params: { filter, perPage: ID_BATCH, skipTotal: 1 }, ...synced });
        out.push(...data.items.map(rec));
      }
      return out;
    },
    /** One record as it is now; null when it's gone. */
    get: (id: string) => orNull(api.get(`${path}/${id}`, synced).then((r) => rec(r.data))),
    /** A new record under the client's own id, at rev 1. Conflict: that id is taken. */
    create: async (r: T): Promise<Versioned<T>> => rec((await api.post(path, r, synced)).data),
    /** The `fields` changed, if still at `rev`. Conflict: it moved on since. null: it's gone. */
    update: (id: string, rev: number, fields: Partial<Omit<T, "id">>): Promise<Versioned<T> | null> =>
      orNull(api.patch(`${path}/${id}`, { ...fields, rev }, synced).then((r) => rec(r.data))),
    /** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
    async remove(id: string, rev: number): Promise<void> {
      await orNull(api.delete(`${path}/${id}`, { params: { rev }, ...synced }));
    },
  };
}

export const tasks = collection<Task>("tasks", taskOf);
