// The icon of each task list (the rail's item and the list's own header), and of each screen the rail lists.
import { CalendarDays, CircleCheckBig, Inbox, NotebookText, Star, type LucideIcon } from "lucide-react";
import type { RailItem } from "@/core/prefs";
import type { TaskView } from "@/lib/nav";

export const TASK_ICON: Record<TaskView, LucideIcon> = {
  inbox: Inbox, today: Star, upcoming: CalendarDays, logbook: CircleCheckBig,
};

export const RAIL_ICON: Record<RailItem, LucideIcon> = { ...TASK_ICON, notes: NotebookText };
