// Tasks on the server: records of their own (ARCHITECTURE.md), each carrying `rev`,
// every write a compare-and-swap on it (server/pb_hooks/rev.pb.js). A client names a new record itself (core/pocketbase.ts
// recordId), so a Conflict from a create is "that id is taken". Shapes: core/todo.ts.
import type { Versioned } from "@/core/pocketbase";
import { taskOf, type Task } from "@/core/todo";
import { api, orNull } from "./api";

export type TaskRec = Versioned<Task>;

const PAGE = 500;

/** The calls for one collection, its records read by `of`. */
function collection<T extends { id: string }>(name: string, of: (r: any) => T) {
  const rec = (r: any): Versioned<T> => ({ ...of(r), rev: r.rev });
  const path = `collections/${name}/records`;
  return {
    rec,
    /** Every record, by `order`: a personal list is small enough that the laptop holds it whole. */
    async all(): Promise<Versioned<T>[]> {
      const out: Versioned<T>[] = [];
      for (let page = 1; ; page++) {
        const { data } = await api.get(path, { params: { sort: "order", perPage: PAGE, page, skipTotal: 1 } });
        out.push(...data.items.map(rec));
        if (data.items.length < PAGE) return out;
      }
    },
    /** One record as it is now; null when it's gone. */
    get: (id: string) => orNull(api.get(`${path}/${id}`).then((r) => rec(r.data))),
    /** A new record under the client's own id, at rev 1. Conflict: that id is taken. */
    create: async (r: T): Promise<Versioned<T>> => rec((await api.post(path, r)).data),
    /** The `fields` changed, if still at `rev`. Conflict: it moved on since. null: it's gone. */
    update: (id: string, rev: number, fields: Partial<Omit<T, "id">>): Promise<Versioned<T> | null> =>
      orNull(api.patch(`${path}/${id}`, { ...fields, rev }).then((r) => rec(r.data))),
    /** Gone, unless it moved on since `rev` (Conflict). Already gone is done. */
    async remove(id: string, rev: number): Promise<void> {
      await orNull(api.delete(`${path}/${id}`, { params: { rev } }));
    },
  };
}

export type Collection<T extends { id: string }> = ReturnType<typeof collection<T>>;

export const tasks = collection<Task>("tasks", taskOf);
