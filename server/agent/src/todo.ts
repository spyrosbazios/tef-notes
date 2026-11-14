// Assistant cards over the task application service; all writes and retries belong to the service.
import { taskCardOf, type TaskCard } from "@/core/agent";
import type { Server } from "@/core/pocketbase";
import { TaskService, type TaskSaved } from "./application/todo";
export { checklistEdit, taskEdit, type Edit, type ChecklistOps, type TagOps } from "./application/todo";
export type TodoSaved = { saved: "task"; id: string; rev: number; card?: TaskCard; next?: string; unchanged?: true } | { error: string };
export type TodoBatch = { saved: "tasks"; ids: string[]; cards: TaskCard[] } | { error: string };

function present(result: TaskSaved): TodoSaved {
  if ("error" in result) return result;
  const { task, ...saved } = result;
  return { ...saved, ...(task ? { card: taskCardOf(task) } : {}) };
}

export class Todo {
  readonly service: TaskService;
  constructor(readonly server: Server) { this.service = new TaskService(server); }
  links(...args: Parameters<TaskService["links"]>) { return this.service.links(...args); }
  notesOf(...args: Parameters<TaskService["notesOf"]>) { return this.service.notesOf(...args); }
  tasks(...args: Parameters<TaskService["tasks"]>) { return this.service.tasks(...args); }
  stamps(...args: Parameters<TaskService["stamps"]>) { return this.service.stamps(...args); }
  task(...args: Parameters<TaskService["task"]>) { return this.service.task(...args); }
  tainted(...args: Parameters<TaskService["tainted"]>) { return this.service.tainted(...args); }
  async taskCard(id: string) {
    const task = await this.service.task(id);
    return task && taskCardOf(task);
  }
  async addTask(...args: Parameters<TaskService["addTask"]>): Promise<TodoSaved> { return present(await this.service.addTask(...args)); }
  async editTask(...args: Parameters<TaskService["editTask"]>): Promise<TodoSaved> { return present(await this.service.editTask(...args)); }
  async completeTask(...args: Parameters<TaskService["completeTask"]>): Promise<TodoSaved> { return present(await this.service.completeTask(...args)); }
  async deleteTask(...args: Parameters<TaskService["deleteTask"]>): Promise<TodoSaved> { return present(await this.service.deleteTask(...args)); }
  async addTasks(...args: Parameters<TaskService["addTasks"]>): Promise<TodoBatch> {
    const result = await this.service.addTasks(...args);
    if ("error" in result) return result;
    const { tasks, ...saved } = result;
    return { ...saved, cards: tasks.map(taskCardOf) };
  }
}
