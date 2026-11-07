// The icon of each task list: the rail's item and the list's own header.
import { CalendarDays, CircleCheckBig, Inbox, Star, type LucideIcon } from "lucide-react";
import type { TaskView } from "@/lib/nav";

export const TASK_ICON: Record<TaskView, LucideIcon> = {
  inbox: Inbox, today: Star, upcoming: CalendarDays, logbook: CircleCheckBig,
};
