// The day's tasks as one list, for what shows them outside the Tasks tab (the home and lock screen widgets, mobile/src/widget/):
// Today's open tasks, This Evening's after them, and the ones ticked today, with the "N of M done" count the widgets
// show. Pure: what counts as Today is core/todo.ts `views`.
import { views, type Task } from "./todo";

export type DayItem = { id: string; title: string; evening: boolean };

export type Day = {
  /** Open: Today's, then This Evening's (`evening`), each by `order`. */
  open: DayItem[];
  /** Ticked today, wherever they were planned, the latest first. */
  done: DayItem[];
  /** The day's work: open and ticked today. */
  total: number;
};

export function dayTasks(tasks: Task[], today: string): Day {
  const v = views(tasks, today);
  const item = (evening: boolean) => (t: Task): DayItem => ({ id: t.id, title: t.title, evening });
  const open = [...v.today.map(item(false)), ...v.evening.map(item(true))];
  const done = v.logbook.filter((t) => t.done === today).map(item(false));
  return { open, done, total: open.length + done.length };
}
