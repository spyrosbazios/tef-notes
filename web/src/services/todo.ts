// Tasks use the shared rev protocol over the web's synced axios transport.
import type { Versioned } from "@/core/record-contracts";
import { revCollection } from "@/core/record-protocol";
import { taskOf, type Task } from "@/core/todo";
import { recordTransport } from "./records";

export type TaskRec = Versioned<Task>;
const collection = revCollection<Task>("tasks", taskOf);
export const tasks = {
  rec: collection.rec,
  revs: () => collection.revs(recordTransport),
  getMany: (ids: string[]) => collection.getMany(recordTransport, ids),
  get: (id: string) => collection.get(recordTransport, id),
  create: (r: Task) => collection.create(recordTransport, r),
  update: (id: string, rev: number, fields: Partial<Omit<Task, "id">>) => collection.update(recordTransport, id, rev, fields),
  remove: (id: string, rev: number) => collection.remove(recordTransport, id, rev),
};
