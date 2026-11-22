// The icon of each task list (the rail's item and the list's own header), and of each screen the rail lists.
import { AudioLines, CalendarDays, CircleCheckBig, House, Inbox, NotebookText, Star, type LucideIcon } from "lucide-react";
import type { RailItem } from "@/core/prefs";
import type { TaskList } from "@/core/things";

export const TASK_ICON: Record<TaskList, LucideIcon> = {
  inbox: Inbox, today: Star, upcoming: CalendarDays, logbook: CircleCheckBig,
};

export const RAIL_ICON: Record<RailItem, LucideIcon> = { home: House, ...TASK_ICON, notes: NotebookText, talk: AudioLines };
