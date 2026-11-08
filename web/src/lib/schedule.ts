// The When picker's language (core/dates.ts Schedule: a day, null: unscheduled) and a task's fields.
import type { Schedule } from "@/core/dates";
import type { Task, TaskPatch } from "@/core/todo";
import type { WhenState } from "@/components/when-picker";

/** Where a task stands, as the When picker shows it. */
export const whenState = (t: Pick<Task, "when" | "evening" | "due">): WhenState =>
  ({ when: t.when || null, evening: t.evening, due: t.due || null });

/** What a When choice writes: its day (evening or not); null: unscheduled. A reminder needs its day, so unscheduling
 *  takes it off. */
export const scheduleOf = (s: Schedule | null): TaskPatch =>
  !s ? { when: "", evening: false, remind: "" } : { when: s.when, evening: s.evening };

/** What a reminder time writes: the time, and, on a task with no day, today (a reminder needs its day). "" takes it off. */
export const remindFields = (remind: string, dated: boolean, today: string): TaskPatch =>
  remind && !dated ? { remind, when: today, evening: false } : { remind };
