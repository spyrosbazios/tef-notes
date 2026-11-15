// Each tab of the phone's bar (core/prefs.ts `TABS`) and its icon: the bar (tab-bar.tsx) and Settings → Layout draw them.
import { AudioLines, House, ListChecks, NotebookText, Settings, Sparkles, type LucideIcon } from "lucide-react";
import type { Tab } from "@/core/prefs";

export const TAB_ICON: Record<Tab, LucideIcon> = { home: House, tasks: ListChecks, notes: NotebookText, ask: Sparkles, talk: AudioLines, settings: Settings };
